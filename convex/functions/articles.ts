import { internalQuery } from "./_generated/server";
import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";

/** Hydrate article docs from vector-search ids, preserving score order. */
export const hydrate = internalQuery({
  args: { ids: v.array(v.id("articles")) },
  handler: async (ctx, args) => {
    const docs = await Promise.all(args.ids.map((id) => ctx.db.get(id)));
    return docs.filter((d): d is Doc<"articles"> => d !== null);
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
