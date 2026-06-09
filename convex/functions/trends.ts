import { query } from "./_generated/server";
import { v } from "convex/values";
import { regionName } from "./lib/regions";
import { computeAnomalies, type EventLike, type Tier } from "./lib/intent";
import { sourceStrength, evidenceFromArticles, type SourceEvidence } from "./lib/sourceConfidence";

const SCAN_LIMIT = 3000;
const ARTICLE_READ_CAP = 400;

/** Time-bucketed activity series + top categories/regions (for /trends). */
export const series = query({
  args: { windowHours: v.optional(v.number()), buckets: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const nBuckets = Math.max(6, Math.min(96, args.buckets ?? 24));
    const now = Date.now();
    const cutoff = now - windowHours * 3_600_000;
    const bucketMs = (windowHours * 3_600_000) / nBuckets;

    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .take(SCAN_LIMIT);

    const buckets = Array.from({ length: nBuckets }, (_, i) => ({
      t: Math.round(cutoff + i * bucketMs),
      total: 0,
      green: 0,
      amber: 0,
      red: 0,
      black: 0,
    }));
    const byCategory = new Map<string, number>();
    const byRegion = new Map<string, number>();
    for (const e of events) {
      const idx = Math.min(nBuckets - 1, Math.max(0, Math.floor((e.publishedAt - cutoff) / bucketMs)));
      buckets[idx].total++;
      buckets[idx][e.tier]++;
      byCategory.set(e.category, (byCategory.get(e.category) ?? 0) + 1);
      if (e.isoA2) byRegion.set(e.isoA2, (byRegion.get(e.isoA2) ?? 0) + 1);
    }

    return {
      buckets,
      bucketMs,
      windowHours,
      total: events.length,
      topCategories: [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([key, count]) => ({ key, count })),
      topRegions: [...byRegion.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .map(([iso, count]) => ({ iso, name: regionName(iso), count })),
    };
  },
});

function toEventLike(e: {
  _id: unknown;
  isoA2: string;
  tier: string;
  severity: number;
  category: string;
  publishedAt: number;
  title: string;
  summary: string;
  source: string;
}): EventLike {
  return {
    id: String(e._id),
    isoA2: e.isoA2,
    tier: e.tier as Tier,
    severity: e.severity,
    category: e.category,
    publishedAt: e.publishedAt,
    title: e.title,
    summary: e.summary,
    source: e.source,
  };
}

/**
 * Severity-bucketed, recency-weighted movers (drives the embedded Trends card
 * AnomalyRows). Scans 2x the window so the baseline split is populated. Scoped
 * to `isoSet` when provided. Returns AnomalyAgg[] (B0 shape).
 */
export const anomalies = query({
  args: { windowHours: v.optional(v.number()), isoSet: v.optional(v.array(v.string())) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const now = Date.now();
    const windowMs = windowHours * 3_600_000;
    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 2 * windowMs))
      .order("desc")
      .take(SCAN_LIMIT);
    const isoSet = args.isoSet && args.isoSet.length ? new Set(args.isoSet) : null;
    const scoped = isoSet ? events.filter((e) => isoSet.has(e.isoA2)) : events;
    return computeAnomalies(scoped.map(toEventLike), windowMs, now, 8);
  },
});

/**
 * Deterministic drill-down — the exact events that drove a category's move.
 * Splits in-window events for `category` into three buckets (precedence order, so
 * the severity signal is never hidden inside "new"):
 *   escalatedEvents — red/black tier in the window (highest priority)
 *   newEvents       — green/amber, firstSeenAt within the window AND no prior-window peer in the region
 *   stableEvents    — green/amber seen before / recurring
 * Each bucket is severity-sorted and capped to a scannable top-N; `*Count`
 * fields report the true totals. Provenance is fetched only for displayed rows.
 */
export const evidence = query({
  args: {
    category: v.string(),
    windowHours: v.optional(v.number()),
    isoSet: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const now = Date.now();
    const windowMs = windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 2 * windowMs))
      .order("desc")
      .take(SCAN_LIMIT);
    const isoSet = args.isoSet && args.isoSet.length ? new Set(args.isoSet) : null;
    const cat = args.category;

    const inCat = rows.filter((e) => e.category === cat && (!isoSet || isoSet.has(e.isoA2)));
    const inWindow = inCat.filter((e) => now - e.publishedAt <= windowMs);
    // A "prior-window peer" exists if any same-region event of this category was
    // already seen before the window opened — used to flag genuinely new threads.
    const priorRegions = new Set(
      inCat.filter((e) => now - e.publishedAt > windowMs).map((e) => e.isoA2),
    );

    // Classify in-window events (cheap, on raw events) with escalated precedence,
    // so a new red/black event surfaces as escalated rather than being swallowed
    // by "new" (which previously left escalatedEvents permanently empty).
    type Ev = (typeof inWindow)[number];
    const escalated: Ev[] = [];
    const fresh: Ev[] = [];
    const stable: Ev[] = [];
    for (const e of inWindow) {
      if (e.tier === "red" || e.tier === "black") escalated.push(e);
      else if (now - e.firstSeenAt <= windowMs && !priorRegions.has(e.isoA2)) fresh.push(e);
      else stable.push(e);
    }
    const bySev = (a: Ev, b: Ev) => b.severity - a.severity;
    escalated.sort(bySev);
    fresh.sort(bySev);
    stable.sort(bySev);

    // Cap each bucket to a scannable drill-down; counts report the true totals.
    const CAP = 15;
    const escTop = escalated.slice(0, CAP);
    const freshTop = fresh.slice(0, CAP);
    const stableTop = stable.slice(0, CAP);

    // Provenance only for the displayed rows (bounded article reads).
    const articlesByKey = new Map<string, SourceEvidence[]>();
    let articleReads = 0;
    for (const e of [...escTop, ...freshTop, ...stableTop]) {
      if (articleReads >= ARTICLE_READ_CAP) break;
      if (articlesByKey.has(e.externalId)) continue;
      const perKey = Math.min(8, ARTICLE_READ_CAP - articleReads);
      const arts = await ctx.db
        .query("articles")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", e.externalId))
        .take(perKey);
      articleReads += arts.length;
      articlesByKey.set(e.externalId, evidenceFromArticles(arts));
    }
    const strengthFor = (e: { externalId: string; source: string; publishedAt: number }) => {
      const ev = articlesByKey.get(e.externalId);
      const s = sourceStrength(ev && ev.length ? ev : [{ source: e.source, publishedAt: e.publishedAt }]);
      return { confidence: s.confidence, label: s.label };
    };
    const toRow = (e: Ev) => ({
      id: e._id,
      externalId: e.externalId,
      title: e.title,
      tier: e.tier,
      severity: e.severity,
      isoA2: e.isoA2,
      category: e.category,
      publishedAt: e.publishedAt,
      articleCount: e.articleCount,
      sourceStrength: strengthFor(e),
    });

    return {
      newEvents: freshTop.map(toRow),
      escalatedEvents: escTop.map(toRow),
      stableEvents: stableTop.map(toRow),
      newCount: fresh.length,
      escalatedCount: escalated.length,
      stableCount: stable.length,
    };
  },
});
