/**
 * Scheduled source-catalog maintenance (the "keep our global feed list healthy"
 * background job). Four behaviors, all cron-driven (see crons.ts):
 *
 *   1. Curated-list SYNC      — maintainCatalog idempotently adds any new feed
 *                               from the in-code DEFAULT_SOURCES so an expanded
 *                               curated list goes live without a manual re-seed.
 *   2. Health LIFECYCLE       — maintainCatalog auto-disables a feed that has
 *                               failed `DISABLE_THRESHOLD` cycles in a row (the
 *                               Rust ingestor stops wasting time on dead feeds).
 *   3. Re-validation/RECOVERY — probeDisabledSources re-fetches auto-disabled
 *                               feeds and re-enables the ones that came back.
 *   4. Gap DISCOVERY          — discoverCandidates flags regions that have real
 *                               news volume but no dedicated feed into the admin
 *                               review queue (sourceRequests), with an optional
 *                               LLM-suggested outlet. Never auto-enables.
 *
 * Auto-disabled vs admin-disabled is tracked by sourceCatalog.autoDisabledAt so
 * recovery never re-enables a feed an operator intentionally turned off.
 */
import { internalQuery, internalMutation, internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { DEFAULT_SOURCES } from "./ingest";

// A feed that errors this many ingest cycles in a row (≈ 2h at the 15-min
// interval) with no success in between is treated as dead and auto-disabled.
const DISABLE_THRESHOLD = 8;
// Per-run bounds so a maintenance tick is always cheap.
const PROBE_BATCH = 25;
const DISCOVER_REGIONS_PER_RUN = 3;
// A region needs at least this much real news volume before a missing feed is
// worth flagging (avoids noise from incidental one-off datelines).
const GAP_EVENT_FLOOR = 10;

/* ───────────────────────── 1 + 2: maintainCatalog ───────────────────────── */

/**
 * Idempotently sync the curated DEFAULT_SOURCES into the catalog and auto-disable
 * persistently-failing feeds. Cheap, safe to run daily.
 */
export const maintainCatalog = internalMutation({
  args: {},
  returns: v.object({ added: v.number(), disabled: v.number(), restored: v.number(), enabledTotal: v.number() }),
  handler: async (ctx) => {
    const now = Date.now();

    // (1) curated-list sync — add any DEFAULT_SOURCES not already present.
    let added = 0;
    for (const s of DEFAULT_SOURCES) {
      const found = await ctx.db
        .query("sourceCatalog")
        .withIndex("by_url", (q) => q.eq("url", s.url))
        .unique();
      if (found) continue;
      await ctx.db.insert("sourceCatalog", {
        name: s.name,
        url: s.url,
        kind: s.kind,
        enabled: true,
        region: s.region,
        category: s.category,
        consecutiveFailures: 0,
        fetchCount: 0,
        itemCount: 0,
        createdAt: now,
      });
      added++;
    }

    // (2) health lifecycle — auto-disable standard feeds dead for too long in a
    // row. gdelt/bluesky firehoses are operator-managed (transient 429s, special
    // fetch semantics) and are never auto-disabled here.
    let disabled = 0;
    const enabled = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    for (const src of enabled) {
      if (
        src.kind !== "gdelt" &&
        src.kind !== "bluesky" &&
        src.consecutiveFailures >= DISABLE_THRESHOLD &&
        src.lastStatus === "err"
      ) {
        await ctx.db.patch(src._id, { enabled: false, autoDisabledAt: now });
        disabled++;
      }
    }

    // Undo any prior over-eager auto-disable of a special firehose source.
    let restored = 0;
    const off = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_enabled", (q) => q.eq("enabled", false))
      .collect();
    for (const src of off) {
      if ((src.kind === "gdelt" || src.kind === "bluesky") && typeof src.autoDisabledAt === "number") {
        await ctx.db.patch(src._id, { enabled: true, autoDisabledAt: undefined, consecutiveFailures: 0 });
        restored++;
      }
    }
    return { added, disabled, restored, enabledTotal: enabled.length - disabled + restored };
  },
});

/* ───────────────────────── 3: probe + recover ───────────────────────── */

export const autoDisabledSources = internalQuery({
  args: {},
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_enabled", (q) => q.eq("enabled", false))
      .collect();
    return rows
      .filter((r) => typeof r.autoDisabledAt === "number" && r.kind !== "gdelt" && r.kind !== "bluesky")
      .slice(0, PROBE_BATCH)
      .map((r) => ({ id: r._id as Id<"sourceCatalog">, url: r.url, name: r.name }));
  },
});

export const recoverSource = internalMutation({
  args: { id: v.id("sourceCatalog") },
  handler: async (ctx, args) => {
    const src = await ctx.db.get(args.id);
    if (!src) return;
    await ctx.db.patch(args.id, {
      enabled: true,
      autoDisabledAt: undefined,
      consecutiveFailures: 0,
      lastStatus: "ok",
      lastError: undefined,
    });
  },
});

/**
 * Re-fetch each auto-disabled feed; re-enable the ones that respond with a valid
 * feed again. Bounded and best-effort — errors never throw out of the cron.
 */
export const probeDisabledSources = internalAction({
  args: {},
  returns: v.object({ probed: v.number(), recovered: v.number() }),
  handler: async (ctx): Promise<{ probed: number; recovered: number }> => {
    const candidates = await ctx.runQuery(internal.sourceSync.autoDisabledSources, {});
    let recovered = 0;
    // Small concurrency so a probe tick stays quick.
    const groups: (typeof candidates)[] = [];
    for (let i = 0; i < candidates.length; i += 6) groups.push(candidates.slice(i, i + 6));
    for (const group of groups) {
      const results = await Promise.all(
        group.map(async (c) => ({ c, live: isPublicHttpUrl(c.url) ? await checkFeed(c.url) : { ok: false } })),
      );
      for (const { c, live } of results) {
        if (live.ok) {
          await ctx.runMutation(internal.sourceSync.recoverSource, { id: c.id });
          recovered++;
        }
      }
    }
    return { probed: candidates.length, recovered };
  },
});

/* ───────────────────────── 4: gap discovery → review queue ───────────────────────── */

export const regionGaps = internalQuery({
  args: {},
  handler: async (ctx) => {
    // Regions with real news volume (coverage rollup) ...
    const coverage = await ctx.db.query("coverage").collect();
    // ... vs. dedicated country-level feeds we actually have.
    const sources = await ctx.db.query("sourceCatalog").collect();
    const sourcedIso = new Set<string>();
    for (const s of sources) {
      const r = (s.region ?? "").toUpperCase();
      if (r.length === 2) sourcedIso.add(r); // dedicated country feed
    }
    const gaps = coverage
      .filter((c) => c.eventCount >= GAP_EVENT_FLOOR && c.isoA2.length === 2 && !sourcedIso.has(c.isoA2.toUpperCase()))
      .sort((a, b) => b.eventCount - a.eventCount)
      .slice(0, DISCOVER_REGIONS_PER_RUN)
      .map((c) => ({ isoA2: c.isoA2.toUpperCase(), eventCount: c.eventCount }));
    return gaps;
  },
});

export const adminUserId = internalQuery({
  args: {},
  handler: async (ctx) => {
    const admins = await ctx.db.query("users").collect();
    const admin = admins.find((u) => u.role === "admin");
    return admin ? (admin._id as Id<"users">) : null;
  },
});

export const queueDiscovery = internalMutation({
  args: {
    userId: v.id("users"),
    isoA2: v.string(),
    name: v.string(),
    url: v.string(),
    reason: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args): Promise<boolean> => {
    // Dedupe: skip if this URL is already catalogued or already pending.
    if (args.url) {
      const cataloged = await ctx.db
        .query("sourceCatalog")
        .withIndex("by_url", (q) => q.eq("url", args.url))
        .unique();
      if (cataloged) return false;
    }
    const pending = await ctx.db
      .query("sourceRequests")
      .withIndex("by_status", (q) => q.eq("status", "pending"))
      .collect();
    if (pending.some((p) => p.region === args.isoA2 || (args.url && p.url === args.url))) return false;
    await ctx.db.insert("sourceRequests", {
      userId: args.userId,
      name: args.name,
      url: args.url || "(needs feed URL — auto-flagged)",
      reason: args.reason,
      region: args.isoA2,
      status: "pending",
      createdAt: Date.now(),
    });
    return true;
  },
});

/**
 * Flag under-sourced regions (real news volume, no dedicated feed) into the admin
 * review queue, with an optional LLM-suggested outlet to evaluate. The admin still
 * vets + approves; nothing is auto-enabled. Best-effort: no-ops when there's no
 * admin to attribute to, or when Ollama is unavailable.
 */
export const discoverCandidates = internalAction({
  args: {},
  returns: v.object({ flagged: v.number(), gaps: v.number() }),
  handler: async (ctx): Promise<{ flagged: number; gaps: number }> => {
    const adminId = await ctx.runQuery(internal.sourceSync.adminUserId, {});
    if (!adminId) return { flagged: 0, gaps: 0 };
    const gaps = await ctx.runQuery(internal.sourceSync.regionGaps, {});
    let flagged = 0;
    for (const g of gaps) {
      const country = COUNTRY_NAME[g.isoA2] ?? g.isoA2;
      const suggestion = await suggestOutlet(country); // {name,url} | null (best-effort LLM)
      const name = suggestion?.name
        ? `[auto] ${country}: ${suggestion.name}`
        : `[auto] ${country} — under-sourced (no dedicated feed)`;
      const url = suggestion?.url && isPublicHttpUrl(suggestion.url) ? suggestion.url : "";
      const reason =
        `Auto-discovered: ${country} has ${g.eventCount} recent events in the corpus but no dedicated national feed. ` +
        (suggestion?.name
          ? `Suggested outlet (UNVERIFIED — please validate before approving): ${suggestion.name} ${suggestion.url ?? ""}`
          : `Please add a reputable national feed for this region.`);
      const ok = await ctx.runMutation(internal.sourceSync.queueDiscovery, {
        userId: adminId,
        isoA2: g.isoA2,
        name,
        url,
        reason,
      });
      if (ok) flagged++;
    }
    return { flagged, gaps: gaps.length };
  },
});

/* ───────────────────────── helpers ───────────────────────── */

/** Reject non-http(s), localhost, and private/reserved IP literals (SSRF guard). */
function isPublicHttpUrl(raw: string): boolean {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return false;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return false;
  const host = u.hostname.toLowerCase();
  if (host === "localhost" || host.endsWith(".local") || host.endsWith(".internal")) return false;
  const m = host.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (m) {
    const a = parseInt(m[1], 10);
    const b = parseInt(m[2], 10);
    if (a === 10 || a === 127 || a === 0 || a >= 224) return false;
    if (a === 169 && b === 254) return false;
    if (a === 172 && b >= 16 && b <= 31) return false;
    if (a === 192 && b === 168) return false;
    if (a === 100 && b >= 64 && b <= 127) return false;
  }
  if (host === "::1" || host.startsWith("fc") || host.startsWith("fd") || host.startsWith("fe80")) return false;
  return true;
}

/** Fetch a URL and decide if it's a live RSS/Atom feed with ≥2 items. */
async function checkFeed(url: string, ms = 12000): Promise<{ ok: boolean; items?: number; status?: number }> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "mapr-watchdesk/1.0 (+https://mapr)",
        accept: "application/rss+xml, application/atom+xml, application/xml;q=0.9, */*;q=0.8",
      },
    });
    if (!res.ok) return { ok: false, status: res.status };
    const text = (await res.text()).slice(0, 200_000);
    const isFeed = /<rss[\s>]|<feed[\s>]|<rdf:rdf[\s>]/i.test(text);
    const items = (text.match(/<item[\s>]|<entry[\s>]/gi) || []).length;
    return { ok: isFeed && items >= 2, items, status: res.status };
  } catch {
    return { ok: false, status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** Best-effort LLM outlet suggestion for a country (Ollama qwen). Null on any error. */
async function suggestOutlet(country: string): Promise<{ name: string; url?: string } | null> {
  const base = process.env.OLLAMA_URL;
  if (!base) return null;
  const model = process.env.LLM_MODEL ?? "qwen2.5:3b";
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20000);
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/v1/chat/completions`, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        ...(process.env.OLLAMA_BEARER ? { authorization: `Bearer ${process.env.OLLAMA_BEARER}` } : {}),
      },
      body: JSON.stringify({
        model,
        temperature: 0.2,
        messages: [
          {
            role: "system",
            content:
              "You suggest reputable national news outlets for a global news watchdesk. Reply with STRICT JSON only.",
          },
          {
            role: "user",
            content:
              `Name ONE reputable national news outlet for ${country} that publishes an RSS or Atom feed. ` +
              `Respond with JSON exactly: {"name":"<outlet>","rss":"<https rss url or empty>"}`,
          },
        ],
      }),
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { choices?: { message?: { content?: string } }[] };
    const content = data.choices?.[0]?.message?.content ?? "";
    const match = content.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as { name?: string; rss?: string };
    if (!parsed.name || typeof parsed.name !== "string") return null;
    return { name: parsed.name.slice(0, 120), url: typeof parsed.rss === "string" ? parsed.rss.slice(0, 300) : undefined };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Minimal ISO2 → country-name map for discovery prose (extend as needed; falls
// back to the ISO code when absent so the flag is still actionable).
const COUNTRY_NAME: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AO: "Angola", AR: "Argentina", AM: "Armenia",
  AU: "Australia", AT: "Austria", AZ: "Azerbaijan", BH: "Bahrain", BD: "Bangladesh", BY: "Belarus",
  BE: "Belgium", BJ: "Benin", BO: "Bolivia", BA: "Bosnia and Herzegovina", BW: "Botswana", BR: "Brazil",
  BG: "Bulgaria", BF: "Burkina Faso", BI: "Burundi", KH: "Cambodia", CM: "Cameroon", CA: "Canada",
  CF: "Central African Republic", TD: "Chad", CL: "Chile", CN: "China", CO: "Colombia", CG: "Republic of the Congo",
  CD: "Democratic Republic of the Congo", CR: "Costa Rica", CI: "Côte d'Ivoire", HR: "Croatia", CU: "Cuba",
  CZ: "Czechia", DK: "Denmark", DJ: "Djibouti", DO: "Dominican Republic", EC: "Ecuador", EG: "Egypt",
  SV: "El Salvador", ER: "Eritrea", EE: "Estonia", SZ: "Eswatini", ET: "Ethiopia", FI: "Finland", FR: "France",
  GA: "Gabon", GM: "Gambia", GE: "Georgia", DE: "Germany", GH: "Ghana", GR: "Greece", GT: "Guatemala",
  GN: "Guinea", GW: "Guinea-Bissau", GY: "Guyana", HT: "Haiti", HN: "Honduras", HU: "Hungary", IS: "Iceland",
  IN: "India", ID: "Indonesia", IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel", IT: "Italy", JM: "Jamaica",
  JP: "Japan", JO: "Jordan", KZ: "Kazakhstan", KE: "Kenya", KW: "Kuwait", KG: "Kyrgyzstan", LA: "Laos",
  LV: "Latvia", LB: "Lebanon", LS: "Lesotho", LR: "Liberia", LY: "Libya", LT: "Lithuania", MG: "Madagascar",
  MW: "Malawi", MY: "Malaysia", MV: "Maldives", ML: "Mali", MR: "Mauritania", MU: "Mauritius", MX: "Mexico",
  MD: "Moldova", MN: "Mongolia", ME: "Montenegro", MA: "Morocco", MZ: "Mozambique", MM: "Myanmar", NA: "Namibia",
  NP: "Nepal", NL: "Netherlands", NZ: "New Zealand", NI: "Nicaragua", NE: "Niger", NG: "Nigeria", MK: "North Macedonia",
  NO: "Norway", OM: "Oman", PK: "Pakistan", PS: "Palestine", PA: "Panama", PG: "Papua New Guinea", PY: "Paraguay",
  PE: "Peru", PH: "Philippines", PL: "Poland", PT: "Portugal", QA: "Qatar", RO: "Romania", RU: "Russia",
  RW: "Rwanda", SA: "Saudi Arabia", SN: "Senegal", RS: "Serbia", SL: "Sierra Leone", SG: "Singapore",
  SK: "Slovakia", SI: "Slovenia", SO: "Somalia", ZA: "South Africa", SS: "South Sudan", KR: "South Korea",
  ES: "Spain", LK: "Sri Lanka", SD: "Sudan", SR: "Suriname", SE: "Sweden", CH: "Switzerland", SY: "Syria",
  TW: "Taiwan", TJ: "Tajikistan", TZ: "Tanzania", TH: "Thailand", TL: "Timor-Leste", TG: "Togo", TT: "Trinidad and Tobago",
  TN: "Tunisia", TR: "Turkey", TM: "Turkmenistan", UG: "Uganda", UA: "Ukraine", AE: "United Arab Emirates",
  GB: "United Kingdom", US: "United States", UY: "Uruguay", UZ: "Uzbekistan", VE: "Venezuela", VN: "Vietnam",
  YE: "Yemen", ZM: "Zambia", ZW: "Zimbabwe",
};
