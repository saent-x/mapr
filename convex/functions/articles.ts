import { internalQuery, query } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { assertIngestKey } from "./lib/access";

/**
 * Ingestor-facing lookup powering the "only embed changed" optimization: given
 * the externalIds the ingestor is about to (re)process, return each one's
 * stored `contentHash` so the worker can skip re-embedding articles whose embed
 * text is unchanged. Returns `null` for the hash of articles that don't exist
 * yet or were written before `contentHash` existed (treated as "changed").
 *
 * Guarded by the shared ingest key, exactly like ingest.ts's ingestBatch /
 * listSources (the only callers are trusted workers).
 */
export const contentHashesByExternalIds = query({
  args: { ingestKey: v.string(), externalIds: v.array(v.string()) },
  returns: v.array(
    v.object({
      externalId: v.string(),
      contentHash: v.union(v.string(), v.null()),
    }),
  ),
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const out: { externalId: string; contentHash: string | null }[] = [];
    for (const externalId of args.externalIds) {
      const doc = await ctx.db
        .query("articles")
        .withIndex("by_externalId", (q) => q.eq("externalId", externalId))
        .unique();
      if (doc) out.push({ externalId, contentHash: doc.contentHash ?? null });
    }
    return out;
  },
});

/** Hydrate article docs from vector-search ids, preserving score order. */
export const hydrate = internalQuery({
  args: { ids: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"articles"> => d !== null);
  },
});

/**
 * ID/eventKey-keyed fetch path (B2). Pull the exact articles for a set of
 * event keys / event ids so scoped or changed events surface even when the
 * vector top-k misses them (REDESIGN §5.3 — Baseline Diff Report prerequisite,
 * and multi-ISO chip scope where `region` collapses to null). REUSES the
 * `by_eventKey` / `by_event` indices.
 */
export const lexicalByEventKeys = internalQuery({
  args: {
    eventKeys: v.optional(v.array(v.string())),
    eventIds: v.optional(v.array(v.string())),
    perKeyLimit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const perKey = Math.max(1, Math.min(8, args.perKeyLimit ?? 3));
    const seen = new Set<string>();
    const out: Doc<"articles">[] = [];

    const push = (d: Doc<"articles"> | null) => {
      if (!d) return;
      const id = String(d._id);
      if (seen.has(id)) return;
      seen.add(id);
      out.push(d);
    };

    for (const key of args.eventKeys ?? []) {
      const rows = await ctx.db
        .query("articles")
        .withIndex("by_eventKey", (q) => q.eq("eventKey", key))
        .order("desc")
        .take(perKey);
      rows.forEach(push);
    }

    for (const raw of args.eventIds ?? []) {
      const eventId = ctx.db.normalizeId("events", raw);
      if (!eventId) continue;
      const rows = await ctx.db
        .query("articles")
        .withIndex("by_event", (q) => q.eq("eventId", eventId))
        .order("desc")
        .take(perKey);
      rows.forEach(push);
    }

    return out;
  },
});

/** Full-text (lexical) retrieval over title+summary, optionally region-scoped. */
export const lexicalSearch = internalQuery({
  args: {
    text: v.string(),
    isoA2: v.optional(v.string()),
    limit: v.number(),
  },
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("articles")
      .withSearchIndex("search_text", (q) => {
        const base = q.search("searchText", args.text);
        return args.isoA2 ? base.eq("isoA2", args.isoA2) : base;
      })
      .take(args.limit);
    return rows;
  },
});
