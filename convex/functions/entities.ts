import { query } from "./_generated/server";
import { v } from "convex/values";
import { sourceStrength, evidenceFromArticles, type SourceEvidence } from "./lib/sourceConfidence";

const SCAN_LIMIT = 1500;
const ARTICLE_READ_CAP = 300;

// Raw-NER noise filter (query-time, conservative). The ingestor's NER emits
// datelines, wire-agency names, and article boilerplate as "entities"; surfacing
// "Details" or "SEOUL May" next to real actors looks unserious. We drop only
// high-confidence noise and never bare proper nouns (e.g. keep "May" — a surname).
const ENTITY_DENYLIST = new Set([
  "details", "update", "updates", "breaking", "exclusive", "analysis", "opinion",
  "editorial", "factbox", "explainer", "live", "newsletter", "advertisement",
  "reuters", "ap", "afp", "yonhap", "bloomberg", "xinhua", "tass", "kyodo",
  "anadolu", "interfax", "sputnik", "pti", "ians", "dpa", "efe",
]);
const CAP_MONTH = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
// Leading ALL-CAPS token (the AP/Reuters dateline city) + a capitalized month →
// "SEOUL May", "BEIRUT, Jun". The all-caps gate keeps real names safe ("Theresa May").
const DATELINE_RE = new RegExp(`^[A-Z]{3,}[A-Z .,'-]*\\s+(${CAP_MONTH})\\b`);
const HAS_DATE_RE = new RegExp(`\\b(${CAP_MONTH})\\.?\\s+\\d{1,2}\\b`, "i"); // "...May 3"

function isNoiseEntity(name: string): boolean {
  const t = (name ?? "").trim();
  if (t.length < 2) return true;
  if (!/[A-Za-z]/.test(t)) return true; // no letters
  if (ENTITY_DENYLIST.has(t.toLowerCase())) return true;
  if (DATELINE_RE.test(t)) return true; // ALL-CAPS city + month dateline fragment
  if (HAS_DATE_RE.test(t)) return true; // contains an explicit "<month> <day>" date
  return false;
}
const SEP = "\u0000";

/** Entity co-occurrence graph (for /entities): nodes = entities, edges = shared events. */
export const graph = query({
  args: { windowHours: v.optional(v.number()), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const limit = Math.max(10, Math.min(80, args.limit ?? 40));
    const cutoff = Date.now() - windowHours * 3_600_000;

    const events = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .take(SCAN_LIMIT);

    const nodeStat = new Map<string, { count: number; severity: number }>();
    const edgeCount = new Map<string, number>();
    for (const e of events) {
      const ents = (e.entities ?? []).filter((x) => !isNoiseEntity(x)).slice(0, 8);
      for (const ent of ents) {
        const n = nodeStat.get(ent) ?? { count: 0, severity: 0 };
        n.count++;
        n.severity = Math.max(n.severity, e.severity);
        nodeStat.set(ent, n);
      }
      for (let i = 0; i < ents.length; i++) {
        for (let j = i + 1; j < ents.length; j++) {
          const key = [ents[i], ents[j]].sort().join(SEP);
          edgeCount.set(key, (edgeCount.get(key) ?? 0) + 1);
        }
      }
    }

    const nodes = [...nodeStat.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, limit)
      .map(([id, s]) => ({ id, count: s.count, severity: s.severity }));
    const keep = new Set(nodes.map((n) => n.id));
    const edges = [...edgeCount.entries()]
      .map(([k, weight]) => {
        const [source, target] = k.split(SEP);
        return { source, target, weight };
      })
      .filter((e) => keep.has(e.source) && keep.has(e.target))
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 140);

    return { nodes, edges, total: events.length };
  },
});

export const dossier = query({
  args: { entity: v.string(), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(SCAN_LIMIT);
    const entity = args.entity.toLowerCase();
    const events = rows.filter((e) => (e.entities ?? []).some((x) => x.toLowerCase() === entity));
    const regions = new Map<string, number>();
    // Per related-entity: co-occurrence count + the events (externalId) they share.
    const related = new Map<string, { count: number; events: typeof events }>();
    let maxSeverity = 0;
    for (const e of events) {
      maxSeverity = Math.max(maxSeverity, e.severity);
      if (e.isoA2) regions.set(e.isoA2, (regions.get(e.isoA2) ?? 0) + 1);
      for (const ent of e.entities ?? []) {
        if (ent.toLowerCase() === entity) continue;
        if (isNoiseEntity(ent)) continue;
        const cur = related.get(ent) ?? { count: 0, events: [] as typeof events };
        cur.count++;
        cur.events.push(e);
        related.set(ent, cur);
      }
    }

    const topRelated = [...related.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 12);

    // Provenance per related entity: source strength over the shared events'
    // backing articles (capped reads, prioritized by co-occurrence rank).
    const articlesByKey = new Map<string, SourceEvidence[]>();
    let articleReads = 0;
    const ensureArticles = async (key: string) => {
      if (articlesByKey.has(key)) return articlesByKey.get(key)!;
      if (articleReads >= ARTICLE_READ_CAP) return [];
      const perKey = Math.min(6, ARTICLE_READ_CAP - articleReads);
      const arts = await ctx.db
        .query("articles")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", key))
        .take(perKey);
      articleReads += arts.length;
      const ev = evidenceFromArticles(arts);
      articlesByKey.set(key, ev);
      return ev;
    };

    const relatedOut = [];
    for (const [name, info] of topRelated) {
      const sharedEventIds = info.events.slice(0, 6).map((e) => e.externalId);
      const ev: SourceEvidence[] = [];
      for (const e of info.events.slice(0, 6)) {
        const arts = await ensureArticles(e.externalId);
        if (arts.length) ev.push(...arts);
        else ev.push({ source: e.source, publishedAt: e.publishedAt });
      }
      const s = sourceStrength(ev);
      relatedOut.push({
        name,
        count: info.count,
        sharedEventIds,
        sourceStrength: { confidence: s.confidence, label: s.label },
      });
    }

    return {
      entity: args.entity,
      eventCount: events.length,
      maxSeverity,
      regions: [...regions.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([iso, count]) => ({ iso, count })),
      related: relatedOut,
      events: events.slice(0, 20).map((e) => ({
        id: e._id,
        externalId: e.externalId,
        title: e.title,
        summary: e.summary,
        isoA2: e.isoA2,
        tier: e.tier,
        severity: e.severity,
        category: e.category,
        publishedAt: e.publishedAt,
        articleCount: e.articleCount,
      })),
    };
  },
});

/**
 * The proof behind one co-occurrence edge (lazy, on hover/click): the events
 * whose entities[] contains BOTH `a` and `b`, plus aggregate source strength
 * over those events' backing articles.
 */
export const edgeProof = query({
  args: { a: v.string(), b: v.string(), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? 168;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(SCAN_LIMIT);
    const a = args.a.toLowerCase();
    const b = args.b.toLowerCase();
    const shared = rows
      .filter((e) => {
        const ents = (e.entities ?? []).map((x) => x.toLowerCase());
        return ents.includes(a) && ents.includes(b);
      })
      .slice(0, 8);

    const evidence: SourceEvidence[] = [];
    let articleReads = 0;
    const sharedEvents = [];
    for (const e of shared) {
      let ev: SourceEvidence[] = [];
      if (articleReads < ARTICLE_READ_CAP) {
        const perKey = Math.min(6, ARTICLE_READ_CAP - articleReads);
        const arts = await ctx.db
          .query("articles")
          .withIndex("by_eventKey", (q) => q.eq("eventKey", e.externalId))
          .take(perKey);
        articleReads += arts.length;
        ev = evidenceFromArticles(arts);
      }
      if (!ev.length) ev = [{ source: e.source, publishedAt: e.publishedAt }];
      evidence.push(...ev);
      const s = sourceStrength(ev);
      sharedEvents.push({
        id: e._id,
        externalId: e.externalId,
        title: e.title,
        summary: e.summary,
        isoA2: e.isoA2,
        tier: e.tier,
        severity: e.severity,
        category: e.category,
        publishedAt: e.publishedAt,
        articleCount: e.articleCount,
        sourceStrength: { confidence: s.confidence, label: s.label },
      });
    }

    const agg = sourceStrength(evidence);
    return {
      sharedEvents,
      sourceStrength: {
        confidence: agg.confidence,
        label: agg.label,
        verifiedSources: agg.verifiedSources,
        socialUnverified: agg.socialUnverified,
      },
    };
  },
});
