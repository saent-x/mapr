/**
 * migrate.ts — one-shot, idempotent, re-runnable backfill of legacy MAPR data
 * into the locked Convex backend.
 *
 * Two workstreams, both safe to re-run (Convex upserts converge):
 *   1. Data backfill: legacy SQLite `articles` -> transform to the frozen
 *      `ingest:ingestBatch` article shape, RE-EMBED each article's text via the
 *      Rust `/embed` HTTP service (1024-dim bge-m3, L2-normalized), batch ~50,
 *      and upsert by `externalId`.
 *   2. Stripe relink: legacy users carrying `stripeCustomerId` +
 *      `subscriptionStatus` -> `ingest:stagePendingBilling` keyed by email.
 *      Convex Auth applies the staged billing to the user on first magic-link
 *      login (and immediately if the user already exists).
 *
 * The legacy SQLite DB is opened READ-ONLY and is never written.
 * Everything talks to Convex over the verified raw HTTP function API
 * (POST /api/query, /api/mutation) — no SDK/websocket needed.
 *
 * Run:  node --experimental-strip-types src/migrate.ts [--dry-run] [--limit N]
 */

import { DatabaseSync } from "node:sqlite";
import { readFileSync, existsSync } from "node:fs";

/**
 * Resolve the legacy DB whether invoked from the repo root (`data/mapr.db`) or
 * from inside `/migration` (`../data/mapr.db`). Returns the first that exists,
 * else the repo-root form so the not-found error names the conventional path.
 */
function defaultLegacyPath(): string {
  const candidates = ["data/mapr.db", "../data/mapr.db"];
  return candidates.find((p) => existsSync(p)) ?? candidates[0]!;
}

// ----------------------------------------------------------------------------
// Config (env with sensible dev defaults)
// ----------------------------------------------------------------------------

const CONVEX_URL = (process.env.CONVEX_URL ?? "http://127.0.0.1:3210").replace(/\/$/, "");
const MAPR_INGEST_KEY = process.env.MAPR_INGEST_KEY ?? "mapr-dev-ingest-secret";
const EMBED_URL = process.env.EMBED_URL ?? "http://127.0.0.1:8088/embed";
const EMBED_BEARER = process.env.EMBED_BEARER ?? "";
const LEGACY_SQLITE_PATH = process.env.LEGACY_SQLITE_PATH ?? defaultLegacyPath();
const INSTANT_EXPORT_PATH = process.env.INSTANT_EXPORT_PATH ?? "";

const EMBEDDING_DIMS = 1024;
const BATCH_SIZE = 50;

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

type Tier = "green" | "amber" | "red" | "black";

/** The frozen ingestBatch article shape, minus the embedding (added at apply). */
interface TransformedArticle {
  externalId: string;
  eventKey: string;
  title: string;
  summary: string;
  source: string;
  url?: string;
  isoA2: string;
  lon: number;
  lat: number;
  tier: Tier;
  severity: number; // 0..10
  category: string;
  publishedAt: number; // ms epoch
}

interface StagedBilling {
  email: string;
  stripeCustomerId: string;
  subscriptionStatus: string;
}

// ----------------------------------------------------------------------------
// Pure transforms (deterministic -> idempotent)
// ----------------------------------------------------------------------------

/**
 * Map legacy category labels (+ NER hint) to the canonical contract set:
 * conflict|cyber|unrest|seismic|weather|economic|health|maritime|tech.
 * Unknown labels fall back to their lowercased form so no information is lost.
 */
const CATEGORY_MAP: Record<string, string> = {
  conflict: "conflict",
  cyber: "cyber",
  civil: "unrest",
  unrest: "unrest",
  political: "unrest",
  weather: "weather",
  climate: "weather",
  disaster: "weather",
  seismic: "seismic",
  health: "health",
  humanitarian: "health",
  economic: "economic",
  maritime: "maritime",
  tech: "tech",
  infrastructure: "tech",
};

function canonicalCategory(legacy: unknown, ner: unknown): string {
  const primary = typeof legacy === "string" ? legacy.toLowerCase().trim() : "";
  const mapped = CATEGORY_MAP[primary];
  if (mapped) return mapped;
  // "General"/unknown top-level: refine with the NER category if it maps.
  const nerKey = typeof ner === "string" ? ner.toLowerCase().trim() : "";
  const nerMapped = CATEGORY_MAP[nerKey];
  if (nerMapped) return nerMapped;
  return primary || "general";
}

/** Legacy severity is a 0..100 score; the contract uses 0..10. */
function scaleSeverity(raw: unknown): number {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n)) return 0;
  return Math.min(10, Math.max(0, n / 10));
}

/**
 * Map a 0..10 severity to a tier. Thresholds chosen to agree with the deployed
 * Convex seed corpus (8.2->red, 6.9->red, 5.5->amber, 3.6->green).
 */
function tierOf(severity: number): Tier {
  if (severity >= 8.5) return "black";
  if (severity >= 6.5) return "red";
  if (severity >= 4) return "amber";
  return "green";
}

function parsePublishedAt(payloadVal: unknown, rowVal: unknown, createdAt: unknown): number {
  for (const candidate of [payloadVal, rowVal, createdAt]) {
    if (typeof candidate === "number" && Number.isFinite(candidate)) return candidate;
    if (typeof candidate === "string") {
      const t = Date.parse(candidate);
      if (Number.isFinite(t)) return t;
    }
  }
  return Date.now();
}

/**
 * Derive the event correlation key. The legacy stores carry no event/cluster id
 * (the `events`/`event_articles` tables are empty), so we synthesize a stable
 * cluster from country + canonical category + UTC day — exactly the grouping
 * `ingestBatch` collapses into one event. Deterministic => re-runs converge.
 */
function deriveEventKey(isoA2: string, category: string, publishedAt: number): string {
  const day = new Date(publishedAt).toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
  return `${isoA2 || "XX"}:${category}:${day}`;
}
/** Strip HTML tags + entities and collapse whitespace from legacy text. */
function cleanText(s: string): string {
  return s
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;|&apos;/gi, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Transform one legacy `articles` row (with parsed payload) to the ingest shape. */
function transformArticle(row: Record<string, unknown>): TransformedArticle {
  let payload: Record<string, unknown> = {};
  if (typeof row.payload === "string") {
    try {
      payload = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }

  const externalId = String(payload.id ?? row.id ?? "");
  const title = cleanText(String(payload.title ?? row.title ?? ""));
  const summaryRaw = cleanText(String(payload.summary ?? title));
  const summary = summaryRaw || title;
  const source = String(payload.source ?? row.source ?? "").trim();
  const urlRaw = payload.url ?? row.url;
  const url = typeof urlRaw === "string" && urlRaw ? urlRaw : undefined;
  const isoA2 = String(payload.isoA2 ?? row.isoA2 ?? "").trim().toUpperCase();

  // Legacy coordinates are [lat, lon]; the contract wants lon + lat separately.
  const coords = Array.isArray(payload.coordinates) ? (payload.coordinates as unknown[]) : [];
  const lat = typeof coords[0] === "number" ? (coords[0] as number) : 0;
  const lon = typeof coords[1] === "number" ? (coords[1] as number) : 0;

  const severity = scaleSeverity(payload.severity ?? row.severity);
  const category = canonicalCategory(payload.category, payload.nerCategory);
  const publishedAt = parsePublishedAt(payload.publishedAt, row.publishedAt, row.createdAt);
  const eventKey = deriveEventKey(isoA2, category, publishedAt);

  return {
    externalId,
    eventKey,
    title,
    summary,
    source,
    url,
    isoA2,
    lon,
    lat,
    tier: tierOf(severity),
    severity,
    category,
    publishedAt,
  };
}

/** Text fed to the embedder: title + summary (deduped when identical). */
function embedText(a: TransformedArticle): string {
  return a.summary && a.summary !== a.title ? `${a.title}\n\n${a.summary}` : a.title;
}

// ----------------------------------------------------------------------------
// Legacy readers (READ-ONLY)
// ----------------------------------------------------------------------------

function openLegacyDb(): InstanceType<typeof DatabaseSync> {
  if (!existsSync(LEGACY_SQLITE_PATH)) {
    throw new Error(`legacy SQLite DB not found at ${LEGACY_SQLITE_PATH} (set LEGACY_SQLITE_PATH)`);
  }
  return new DatabaseSync(LEGACY_SQLITE_PATH, { readOnly: true });
}

function tableExists(db: InstanceType<typeof DatabaseSync>, name: string): boolean {
  const row = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name = ?")
    .get(name);
  return Boolean(row);
}

function readLegacyArticles(
  db: InstanceType<typeof DatabaseSync>,
  limit: number | null,
): Record<string, unknown>[] {
  const sql = limit
    ? "SELECT * FROM articles ORDER BY publishedAt DESC LIMIT ?"
    : "SELECT * FROM articles ORDER BY publishedAt DESC";
  const stmt = db.prepare(sql);
  return (limit ? stmt.all(limit) : stmt.all()) as Record<string, unknown>[];
}

/**
 * Collect users-to-relink from (a) the InstantDB export JSON and (b) a legacy
 * SQLite `users` table if one exists. A record qualifies only when it carries
 * email + stripeCustomerId + subscriptionStatus. Returns deduped-by-email.
 */
function readStagedBilling(db: InstanceType<typeof DatabaseSync>): {
  staged: StagedBilling[];
  skipped: number;
  sources: string[];
} {
  const byEmail = new Map<string, StagedBilling>();
  let skipped = 0;
  const sources: string[] = [];

  const ingest = (rec: unknown): void => {
    if (!rec || typeof rec !== "object") return;
    const r = rec as Record<string, unknown>;
    const email = typeof r.email === "string" ? r.email.toLowerCase().trim() : "";
    const stripeCustomerId = typeof r.stripeCustomerId === "string" ? r.stripeCustomerId.trim() : "";
    const subscriptionStatus =
      typeof r.subscriptionStatus === "string" ? r.subscriptionStatus.trim() : "";
    if (email && stripeCustomerId && subscriptionStatus) {
      byEmail.set(email, { email, stripeCustomerId, subscriptionStatus });
    } else if (email && (stripeCustomerId || subscriptionStatus)) {
      skipped++; // partial billing data — not enough to stage
    }
  };

  // (a) InstantDB export JSON — tolerant of common export shapes.
  if (INSTANT_EXPORT_PATH) {
    if (!existsSync(INSTANT_EXPORT_PATH)) {
      throw new Error(`INSTANT_EXPORT_PATH set but file not found: ${INSTANT_EXPORT_PATH}`);
    }
    const parsed = JSON.parse(readFileSync(INSTANT_EXPORT_PATH, "utf8")) as unknown;
    const userRecords = extractUserRecords(parsed);
    userRecords.forEach(ingest);
    sources.push(`instant-export:${INSTANT_EXPORT_PATH}`);
  }

  // (b) Optional legacy SQLite `users` table (absent in the GDELT cache DB).
  if (tableExists(db, "users")) {
    const rows = db.prepare("SELECT * FROM users").all() as Record<string, unknown>[];
    rows.forEach(ingest);
    sources.push("sqlite:users");
  }

  return { staged: [...byEmail.values()], skipped, sources };
}

/**
 * Find user-like records inside an arbitrary InstantDB export. Handles:
 *   { "$users": [...] } | { "users": [...] } | { data: { $users: [...] } }
 *   | top-level array | nested arrays of objects bearing an `email`.
 */
function extractUserRecords(parsed: unknown): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const seen = new Set<unknown>();

  const looksLikeUser = (o: Record<string, unknown>): boolean =>
    typeof o.email === "string" &&
    ("stripeCustomerId" in o || "subscriptionStatus" in o);

  const visit = (node: unknown, keyHint: string): void => {
    if (!node || typeof node !== "object" || seen.has(node)) return;
    seen.add(node);
    if (Array.isArray(node)) {
      const objs = node.filter((x): x is Record<string, unknown> => Boolean(x) && typeof x === "object" && !Array.isArray(x));
      const userish = objs.filter(looksLikeUser);
      // Prefer an explicit users namespace, else any array whose objects look like users.
      if (userish.length > 0 && (/users?$/i.test(keyHint) || userish.length === objs.length)) {
        out.push(...userish);
      }
      for (const item of node) visit(item, keyHint);
      return;
    }
    for (const [k, v] of Object.entries(node as Record<string, unknown>)) visit(v, k);
  };

  visit(parsed, "root");
  // Dedup by identity in case nested traversal re-collected the same record.
  return [...new Set(out)];
}

// ----------------------------------------------------------------------------
// HTTP clients (Convex raw function API + Rust /embed)
// ----------------------------------------------------------------------------

async function convexMutation<T = unknown>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX_URL}/api/mutation`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { status: string; value?: T; errorMessage?: string };
  if (body.status !== "success") throw new Error(`${path}: ${body.errorMessage ?? "convex error"}`);
  return body.value as T;
}

async function convexQuery<T = unknown>(path: string, args: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${CONVEX_URL}/api/query`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ path, args, format: "json" }),
  });
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { status: string; value?: T; errorMessage?: string };
  if (body.status !== "success") throw new Error(`${path}: ${body.errorMessage ?? "convex error"}`);
  return body.value as T;
}

/** Re-embed a batch of texts via the Rust /embed service -> 1024-dim vectors. */
async function embed(texts: string[]): Promise<number[][]> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (EMBED_BEARER) headers.authorization = `Bearer ${EMBED_BEARER}`;
  const res = await fetch(EMBED_URL, {
    method: "POST",
    headers,
    body: JSON.stringify({ inputs: texts, normalize: true }),
  });
  if (!res.ok) throw new Error(`/embed: HTTP ${res.status} ${await res.text()}`);
  const body = (await res.json()) as { vectors?: number[][] };
  const vectors = body.vectors;
  if (!Array.isArray(vectors) || vectors.length !== texts.length) {
    throw new Error(`/embed: expected ${texts.length} vectors, got ${vectors?.length ?? 0}`);
  }
  for (const v of vectors) {
    if (!Array.isArray(v) || v.length !== EMBEDDING_DIMS) {
      throw new Error(`/embed: vector must be ${EMBEDDING_DIMS}-dim, got ${v?.length ?? 0}`);
    }
  }
  return vectors;
}

// ----------------------------------------------------------------------------
// Dry run
// ----------------------------------------------------------------------------

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function dryRun(limit: number | null): void {
  const db = openLegacyDb();
  try {
    const articleRows = readLegacyArticles(db, limit);
    const eventCount = (db.prepare("SELECT COUNT(*) AS c FROM events").get() as { c: number }).c;
    const { staged, skipped, sources } = readStagedBilling(db);

    const transformed = articleRows.map(transformArticle);

    const distinctSources = new Set(transformed.map((a) => a.source)).size;
    const catBreakdown: Record<string, number> = {};
    const tierBreakdown: Record<string, number> = {};
    const eventKeys = new Set<string>();
    for (const a of transformed) {
      catBreakdown[a.category] = (catBreakdown[a.category] ?? 0) + 1;
      tierBreakdown[a.tier] = (tierBreakdown[a.tier] ?? 0) + 1;
      eventKeys.add(a.eventKey);
    }

    console.log("=== MAPR migration — DRY RUN (no writes) ===\n");
    console.log("Targets:");
    console.log(`  CONVEX_URL          ${CONVEX_URL}`);
    console.log(`  EMBED_URL           ${EMBED_URL}  (required for apply)`);
    console.log(`  LEGACY_SQLITE_PATH  ${LEGACY_SQLITE_PATH} (read-only)`);
    console.log(`  INSTANT_EXPORT_PATH ${INSTANT_EXPORT_PATH || "(none — users not staged)"}\n`);

    console.log("Row counts per source:");
    console.log(`  legacy articles        ${articleRows.length}${limit ? ` (capped by --limit ${limit})` : ""}`);
    console.log(`  legacy events table    ${eventCount}`);
    console.log(`  distinct article sources ${distinctSources}`);
    console.log(`  derived event clusters   ${eventKeys.size}`);
    console.log(`  users to stage (billing) ${staged.length}${skipped ? ` (+${skipped} partial, skipped)` : ""}`);
    console.log(`  billing sources          ${sources.length ? sources.join(", ") : "(none)"}\n`);

    console.log("Canonical category breakdown:", JSON.stringify(catBreakdown));
    console.log("Tier breakdown:", JSON.stringify(tierBreakdown), "\n");

    const samples = pickSpread(transformed, 3);
    console.log("Spot-check TRANSFORMED articles (embedding re-computed at apply):");
    samples.forEach((a, i) => {
      console.log(`\n  [${i + 1}] externalId=${a.externalId}`);
      console.log(
        "  " +
          JSON.stringify(
            {
              ...a,
              publishedAtISO: new Date(a.publishedAt).toISOString(),
              embedText: truncate(embedText(a), 120),
              embedding: `<${EMBEDDING_DIMS}-dim bge-m3, fetched from ${EMBED_URL} at apply>`,
            },
            null,
            0,
          ),
      );
    });

    console.log("\nSpot-check STAGED-BILLING record (ingest:stagePendingBilling):");
    if (staged.length > 0) {
      console.log("  " + JSON.stringify(staged[0]));
    } else {
      console.log(
        "  (no users found — set INSTANT_EXPORT_PATH to an InstantDB export.) Example shape:",
      );
      console.log(
        "  " +
          JSON.stringify({
            email: "user@example.com",
            stripeCustomerId: "cus_XXXXXXXX",
            subscriptionStatus: "active",
          }),
      );
    }
    console.log("\nDry run complete. No data written.");
  } finally {
    db.close();
  }
}

function pickSpread<T>(arr: T[], n: number): T[] {
  if (arr.length <= n) return arr.slice();
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(arr[Math.floor((i * (arr.length - 1)) / (n - 1))]!);
  }
  return out;
}

function truncate(s: string, n: number): string {
  return s.length > n ? s.slice(0, n) + "…" : s;
}

// ----------------------------------------------------------------------------
// Apply
// ----------------------------------------------------------------------------

async function apply(limit: number | null): Promise<void> {
  const db = openLegacyDb();
  let read = 0;
  let inserted = 0;
  let updated = 0;
  let events = 0;
  let staged = 0;
  const errors: string[] = [];

  try {
    console.log("=== MAPR migration — APPLY ===");
    console.log(`Convex: ${CONVEX_URL}  Embed: ${EMBED_URL}  Legacy: ${LEGACY_SQLITE_PATH}\n`);

    // --- 1. Article backfill (re-embed -> ingestBatch) ----------------------
    const articleRows = readLegacyArticles(db, limit);
    read = articleRows.length;
    const transformed = articleRows
      .map(transformArticle)
      .filter((a) => a.externalId && a.title); // skip rows with no id/title
    const batches = chunk(transformed, BATCH_SIZE);
    console.log(`Backfilling ${transformed.length} articles in ${batches.length} batch(es) of ${BATCH_SIZE}...`);

    for (let b = 0; b < batches.length; b++) {
      const batch = batches[b]!;
      try {
        const vectors = await embed(batch.map(embedText));
        const articles = batch.map((a, i) => ({
          externalId: a.externalId,
          eventKey: a.eventKey,
          title: a.title,
          summary: a.summary,
          source: a.source,
          url: a.url,
          isoA2: a.isoA2,
          lon: a.lon,
          lat: a.lat,
          tier: a.tier,
          severity: a.severity,
          category: a.category,
          publishedAt: a.publishedAt,
          embedding: vectors[i]!,
        }));
        const r = await convexMutation<{ inserted: number; updated: number; events: number }>(
          "ingest:ingestBatch",
          { ingestKey: MAPR_INGEST_KEY, articles },
        );
        inserted += r.inserted;
        updated += r.updated;
        events += r.events;
        console.log(
          `  batch ${b + 1}/${batches.length}: +${r.inserted} ins, ~${r.updated} upd, ${r.events} events`,
        );
      } catch (err) {
        const msg = `batch ${b + 1}/${batches.length}: ${(err as Error).message}`;
        errors.push(msg);
        console.error(`  ! ${msg} (continuing)`);
      }
    }

    // --- 2. Stripe relink staging -------------------------------------------
    const billing = readStagedBilling(db);
    if (billing.staged.length > 0) {
      console.log(`\nStaging ${billing.staged.length} billing relink(s) from ${billing.sources.join(", ")}...`);
      for (const u of billing.staged) {
        try {
          await convexMutation("ingest:stagePendingBilling", {
            ingestKey: MAPR_INGEST_KEY,
            email: u.email,
            stripeCustomerId: u.stripeCustomerId,
            subscriptionStatus: u.subscriptionStatus,
          });
          staged++;
        } catch (err) {
          const msg = `stage ${u.email}: ${(err as Error).message}`;
          errors.push(msg);
          console.error(`  ! ${msg} (continuing)`);
        }
      }
      console.log("  Convex Auth applies these on each user's first magic-link login.");
    } else {
      console.log(
        `\nNo billing relinks to stage (set INSTANT_EXPORT_PATH to an InstantDB export).`,
      );
    }
  } finally {
    db.close();
  }

  console.log("\n=== Summary ===");
  console.log(`  read    ${read} legacy articles`);
  console.log(`  wrote   ${inserted + updated} articles (${inserted} inserted, ${updated} updated)`);
  console.log(`  events  ${events} recomputed`);
  console.log(`  staged  ${staged} billing relinks`);
  console.log(`  errors  ${errors.length}`);
  if (errors.length > 0) {
    console.log("  error detail:");
    for (const e of errors) console.log(`    - ${e}`);
  }

  // Convenience verification probe (read-only; never fatal).
  try {
    const evs = await convexQuery<unknown[]>("events:list", {});
    console.log(`\nVerify: events:list now returns ${Array.isArray(evs) ? evs.length : "?"} events.`);
  } catch (err) {
    console.log(`\nVerify probe failed (non-fatal): ${(err as Error).message}`);
  }

  process.exitCode = errors.length > 0 ? 1 : 0;
}

// ----------------------------------------------------------------------------
// CLI
// ----------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dry-run");
  const limitIdx = args.indexOf("--limit");
  const limit = limitIdx >= 0 && args[limitIdx + 1] ? Number(args[limitIdx + 1]) : null;
  if (limit !== null && (!Number.isInteger(limit) || limit <= 0)) {
    throw new Error("--limit must be a positive integer");
  }

  if (isDryRun) {
    dryRun(limit);
  } else {
    await apply(limit);
  }
}

main().catch((err) => {
  console.error(`\nFATAL: ${(err as Error).message}`);
  process.exit(1);
});
