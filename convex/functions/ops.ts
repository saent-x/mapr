import { internalQuery, internalAction } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";

/**
 * Lightweight operational observability (#11).
 *
 * The ingest pipeline (Rust ingestor → Convex) has no dead-man's switch: if it
 * stops fetching, failures stay invisible until a human opens /admin. This adds
 * a cheap ingest-staleness alert. `ingestHealth` derives the last successful
 * ingest from EXISTING data (no new tables), and `checkIngestHealth` (cron,
 * crons.ts) emails the admin via the project's existing Resend integration when
 * the pipeline goes stale beyond a threshold.
 *
 * No LLM, no new schema. If Resend isn't configured it logs and no-ops.
 */

// Staleness threshold: a healthy pipeline fetches well under this. Past it, the
// ingestor is considered down and the admin is paged.
const STALE_THRESHOLD_MINUTES = 90;

type IngestHealth = {
  lastSuccessAt: number | null;
  stale: boolean;
  ageMinutes: number | null;
};

/**
 * Derive ingest health from existing data: the most recent successful source
 * fetch (`sourceCatalog.lastFetchedAt`) or, failing that, the newest article
 * (`articles.publishedAt`). `stale` is true once the last success is older than
 * STALE_THRESHOLD_MINUTES. Returns nulls (and stale=false) when there's simply
 * no data yet — a fresh/empty deployment shouldn't page anyone.
 */
export const ingestHealth = internalQuery({
  args: {},
  returns: v.object({
    lastSuccessAt: v.union(v.number(), v.null()),
    stale: v.boolean(),
    ageMinutes: v.union(v.number(), v.null()),
  }),
  handler: async (ctx): Promise<IngestHealth> => {
    // Max sourceCatalog.lastFetchedAt across the catalog.
    let lastSuccessAt: number | null = null;
    const sources = await ctx.db.query("sourceCatalog").collect();
    for (const s of sources) {
      if (s.lastFetchedAt !== undefined && (lastSuccessAt === null || s.lastFetchedAt > lastSuccessAt)) {
        lastSuccessAt = s.lastFetchedAt;
      }
    }

    // Fallback: newest article publishedAt (covers deployments whose ingestor
    // doesn't stamp lastFetchedAt, or pre-catalog data).
    if (lastSuccessAt === null) {
      const newest = await ctx.db
        .query("articles")
        .withIndex("by_publishedAt")
        .order("desc")
        .first();
      if (newest) lastSuccessAt = newest.publishedAt;
    }

    if (lastSuccessAt === null) {
      // No ingest data at all — treat as not-yet-started, not a failure.
      return { lastSuccessAt: null, stale: false, ageMinutes: null };
    }

    const ageMinutes = (Date.now() - lastSuccessAt) / 60_000;
    return {
      lastSuccessAt,
      stale: ageMinutes > STALE_THRESHOLD_MINUTES,
      ageMinutes,
    };
  },
});

/** Admin recipient(s) for ops alerts — the same ADMIN_EMAILS list auth uses. */
function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim())
    .filter(Boolean);
}

/**
 * Send an ops alert via the EXISTING Resend integration (same env vars as
 * digests.ts: AUTH_RESEND_KEY / AUTH_EMAIL_FROM). Returns false (graceful
 * no-op) when Resend or the admin list isn't configured.
 */
async function sendOpsAlert(subject: string, html: string): Promise<boolean> {
  const key = process.env.AUTH_RESEND_KEY;
  const from = process.env.AUTH_EMAIL_FROM ?? "MAPR <noreply@mapr.app>";
  const to = adminEmails();
  if (!key) {
    console.warn("[ops] ingest stale but AUTH_RESEND_KEY not set — alert not delivered");
    return false;
  }
  if (to.length === 0) {
    console.warn("[ops] ingest stale but ADMIN_EMAILS not set — alert not delivered");
    return false;
  }
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
    body: JSON.stringify({ from, to, subject, html }),
  });
  return res.ok;
}

/**
 * Cron entrypoint (crons.ts). Checks ingest staleness and, if stale beyond
 * STALE_THRESHOLD_MINUTES, pages the admin via Resend. Cheap + side-effect-free
 * when healthy. Logs and no-ops gracefully when email isn't configured.
 */
export const checkIngestHealth = internalAction({
  args: {},
  returns: v.object({ stale: v.boolean(), alerted: v.boolean(), ageMinutes: v.union(v.number(), v.null()) }),
  handler: async (ctx): Promise<{ stale: boolean; alerted: boolean; ageMinutes: number | null }> => {
    const health = await ctx.runQuery(internal.ops.ingestHealth, {});
    if (!health.stale) return { stale: false, alerted: false, ageMinutes: health.ageMinutes };

    const ageMin = health.ageMinutes ?? 0;
    const lastSeen = health.lastSuccessAt ? new Date(health.lastSuccessAt).toISOString() : "unknown";
    console.warn(`[ops] INGEST STALE — last success ${Math.round(ageMin)}m ago (${lastSeen})`);

    const html =
      `<h2>MAPR ingest pipeline appears stale</h2>` +
      `<p>No successful ingest in the last <b>${Math.round(ageMin)} minutes</b> ` +
      `(threshold ${STALE_THRESHOLD_MINUTES}m).</p>` +
      `<p>Last successful ingest: <b>${lastSeen}</b>.</p>` +
      `<p>Check the Rust ingestor + source catalog health in /admin.</p>`;
    const alerted = await sendOpsAlert(
      `MAPR alert: ingest stale (${Math.round(ageMin)}m)`,
      html,
    );
    return { stale: true, alerted, ageMinutes: health.ageMinutes };
  },
});
