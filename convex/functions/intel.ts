import { query } from "./_generated/server";
import { v } from "convex/values";
import { computeRegions, computeAnomalies, type EventLike, type Tier } from "./lib/intent";
import { regionName } from "./lib/regions";
import { sourceStrength, evidenceFromArticles, type SourceEvidence } from "./lib/sourceConfidence";

const SCAN_LIMIT = 2000;
const ARTICLE_READ_CAP = 400; // bound article reads for region/category provenance
const TIER_RANK: Record<Tier, number> = { green: 0, amber: 1, red: 2, black: 3 };
const TIER_BY_RANK: Tier[] = ["green", "amber", "red", "black"];

/** Deterministic situation overview (for /intel): tiers, hotspots, anomalies, top events. */
export const overview = query({
  args: { windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 24;
    const now = Date.now();
    const windowMs = windowHours * 3_600_000;
    // Scan 2x the window so anomaly baselines have a prior period.
    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", now - 2 * windowMs))
      .order("desc")
      .take(SCAN_LIMIT);

    const like: EventLike[] = events.map((e) => ({
      id: String(e._id),
      isoA2: e.isoA2,
      tier: e.tier as Tier,
      severity: e.severity,
      category: e.category,
      publishedAt: e.publishedAt,
      title: e.title,
      summary: e.summary,
      source: e.source,
    }));
    const inWindow = events.filter((e) => now - e.publishedAt <= windowMs);
    const priorWindow = events.filter((e) => {
      const age = now - e.publishedAt;
      return age > windowMs && age <= 2 * windowMs;
    });
    const tierCounts = { green: 0, amber: 0, red: 0, black: 0 };
    for (const e of inWindow) tierCounts[e.tier]++;

    // ── Provenance: fetch backing articles for the in-window events, keyed by
    // eventKey (events.externalId). Cap total article reads. We read newest-window
    // events first so the most relevant provenance is always populated. ──
    const articlesByKey = new Map<string, SourceEvidence[]>();
    let articleReads = 0;
    for (const e of inWindow) {
      if (articleReads >= ARTICLE_READ_CAP) break;
      if (articlesByKey.has(e.externalId)) continue;
      const perKey = Math.min(8, ARTICLE_READ_CAP - articleReads);
      const rows = await ctx.db
        .query("articles")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", e.externalId))
        .take(perKey);
      articleReads += rows.length;
      articlesByKey.set(e.externalId, evidenceFromArticles(rows));
    }

    // Fallback evidence for events whose articles weren't fetched (use the event's
    // own single `source` so the strength is never empty).
    const evidenceForEvent = (externalId: string, source: string, publishedAt: number): SourceEvidence[] => {
      const fetched = articlesByKey.get(externalId);
      if (fetched && fetched.length) return fetched;
      return [{ source, publishedAt }];
    };

    // Region-level source strength + urgency (max recency weight over its events).
    const regionEvidence = new Map<string, SourceEvidence[]>();
    const regionLastAt = new Map<string, number>();
    for (const e of inWindow) {
      if (!e.isoA2) continue;
      const ev = regionEvidence.get(e.isoA2) ?? [];
      ev.push(...evidenceForEvent(e.externalId, e.source, e.publishedAt));
      regionEvidence.set(e.isoA2, ev);
      regionLastAt.set(e.isoA2, Math.max(regionLastAt.get(e.isoA2) ?? 0, e.publishedAt));
    }
    const TWO_H = 2 * 3_600_000;
    const recencyWeightFor = (lastAt: number): number => {
      if (!lastAt) return 0;
      const age = now - lastAt;
      if (age <= TWO_H) return 1;
      const span = Math.max(1, windowMs - TWO_H);
      return Math.max(0, Math.min(1, 1 - (age - TWO_H) / span));
    };

    const regionsBase = computeRegions(like.filter((e) => now - e.publishedAt <= windowMs), 6);
    const regions = regionsBase.map((r) => ({
      ...r,
      sourceStrength: sourceStrength(regionEvidence.get(r.iso) ?? []),
      recencyWeight: recencyWeightFor(regionLastAt.get(r.iso) ?? 0),
    }));

    const anomalies = computeAnomalies(like, windowMs, now, 8);

    // ── Situation headline facts ──
    const blackCount = tierCounts.black;
    const redCount = tierCounts.red;
    let level: "GREEN" | "AMBER" | "RED" | "BLACK" = "GREEN";
    if (tierCounts.black > 0) level = "BLACK";
    else if (tierCounts.red > 0) level = "RED";
    else if (tierCounts.amber > 0) level = "AMBER";

    const priorRegions = new Set(priorWindow.map((e) => e.isoA2).filter(Boolean));
    const windowRegions = new Set(inWindow.map((e) => e.isoA2).filter(Boolean));
    const newRegions = [...windowRegions]
      .filter((iso) => !priorRegions.has(iso))
      .slice(0, 6)
      .map((iso) => ({ iso, name: regionName(iso) }));

    // ── Top events with provenance ──
    const topEventDocs = [...inWindow].sort((a, b) => b.severity - a.severity).slice(0, 8);
    const topEvents = topEventDocs.map((e) => ({
      id: e._id,
      title: e.title,
      tier: e.tier,
      severity: e.severity,
      category: e.category,
      isoA2: e.isoA2,
      publishedAt: e.publishedAt,
      externalId: e.externalId,
      articleCount: e.articleCount,
      sourceStrength: sourceStrength(evidenceForEvent(e.externalId, e.source, e.publishedAt)),
    }));

    return {
      windowHours,
      total: inWindow.length,
      tierCounts,
      situation: {
        level,
        blackCount,
        redCount,
        topAnomalies: anomalies.slice(0, 3),
        newRegions,
      },
      regions,
      anomalies,
      topEvents,
    };
  },
});

export { TIER_RANK, TIER_BY_RANK };
