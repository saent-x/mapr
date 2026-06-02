import { mutation, query } from "./_generated/server";
import { v } from "convex/values";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc } from "./_generated/dataModel";
import { getCurrentUser, requireUser } from "./lib/access";
import { requireFeature } from "./lib/entitlements";
import { summarizeSources } from "./lib/sourceConfidence";

const DEFAULT_WINDOW_HOURS = 24;
const MAX_EVENTS = 80;
const MAX_CITATIONS = 10;

const scopeTypeValidator = v.union(
  v.literal("global"),
  v.literal("region"),
  v.literal("entity"),
  v.literal("watchlist"),
  v.literal("savedView"),
  v.literal("case"),
);

type Ctx = MutationCtx | QueryCtx;
type Predicate = (event: Doc<"events">) => boolean;
type UserId = Doc<"users">["_id"];

function tierRank(tier: Doc<"events">["tier"]): number {
  if (tier === "black") return 4;
  if (tier === "red") return 3;
  if (tier === "amber") return 2;
  return 1;
}

function eventText(event: Doc<"events">): string {
  return `${event.title} ${event.summary} ${(event.entities ?? []).join(" ")}`.toLowerCase();
}

function basicScopePredicate(scopeType: string, scopeValue?: string): Predicate {
  return (event) => {
    if (scopeType === "global" || !scopeValue) return true;
    if (scopeType === "region") return event.isoA2.toUpperCase() === scopeValue.toUpperCase();
    if (scopeType === "entity") return (event.entities ?? []).some((e) => e.toLowerCase() === scopeValue.toLowerCase());
    return true;
  };
}

function savedViewPredicate(filterState: string): Predicate {
  try {
    const raw: unknown = JSON.parse(filterState);
    if (!raw || typeof raw !== "object") return () => true;
    const obj = raw as Record<string, unknown>;
    const regions = Array.isArray(obj.regions) ? obj.regions.filter((x): x is string => typeof x === "string") : [];
    const isoA2 = typeof obj.isoA2 === "string" ? obj.isoA2 : typeof obj.region === "string" ? obj.region : null;
    const categories = Array.isArray(obj.categories) ? obj.categories.filter((x): x is string => typeof x === "string") : [];
    const category = typeof obj.category === "string" ? obj.category : null;
    const tiers = Array.isArray(obj.tiers) ? obj.tiers.filter((x): x is string => typeof x === "string") : [];
    const minSeverity = typeof obj.minSeverity === "number" ? obj.minSeverity : null;
    const queryText = typeof obj.query === "string" ? obj.query.toLowerCase() : null;
    return (event) => {
      if (isoA2 && event.isoA2 !== isoA2) return false;
      if (regions.length > 0 && !regions.includes(event.isoA2)) return false;
      if (category && event.category !== category) return false;
      if (categories.length > 0 && !categories.includes(event.category)) return false;
      if (tiers.length > 0 && !tiers.includes(event.tier)) return false;
      if (minSeverity !== null && event.severity < minSeverity) return false;
      if (queryText && !eventText(event).includes(queryText)) return false;
      return true;
    };
  } catch {
    return () => true;
  }
}

async function scopePredicate(ctx: Ctx, userId: UserId | null, scopeType: string, scopeValue?: string): Promise<Predicate> {
  if (scopeType === "watchlist") {
    if (!userId) return () => false;
    const items = await ctx.db
      .query("watchlistItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return (event) => items.some((item) => {
      if (scopeValue && String(item._id) !== scopeValue && item.value !== scopeValue) return false;
      if (item.type === "region") return item.value.toUpperCase() === event.isoA2.toUpperCase();
      if (item.type === "entity") return (event.entities ?? []).some((e) => e.toLowerCase() === item.value.toLowerCase());
      if (item.type === "keyword") return eventText(event).includes(item.value.toLowerCase());
      return false;
    });
  }
  if (scopeType === "savedView") {
    if (!userId || !scopeValue) return () => false;
    const views = await ctx.db
      .query("savedViews")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const view = views.find((v) => String(v._id) === scopeValue);
    return view ? savedViewPredicate(view.filterState) : () => false;
  }
  if (scopeType === "case") {
    if (!userId || !scopeValue) return () => false;
    const items = await ctx.db
      .query("caseItems")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const caseItems = items.filter((item) => String(item.caseId) === scopeValue);
    return (event) => caseItems.some((item) => {
      if (item.eventId && String(item.eventId) === String(event._id)) return true;
      if (item.region && item.region.toUpperCase() === event.isoA2.toUpperCase()) return true;
      const entity = item.entity;
      if (entity && (event.entities ?? []).some((e) => e.toLowerCase() === entity.toLowerCase())) return true;
      if (item.note && eventText(event).includes(item.note.toLowerCase())) return true;
      return false;
    });
  }
  return basicScopePredicate(scopeType, scopeValue);
}

function summarizeEvents(events: Doc<"events">[]): {
  summary: string;
  sections: { title: string; body: string }[];
} {
  const byTier: Record<Doc<"events">["tier"], number> = { green: 0, amber: 0, red: 0, black: 0 };
  const byRegion = new Map<string, number>();
  const byCategory = new Map<string, number>();
  const entities = new Map<string, number>();
  let maxTier: Doc<"events">["tier"] = "green";
  for (const event of events) {
    byTier[event.tier] += 1;
    if (tierRank(event.tier) > tierRank(maxTier)) maxTier = event.tier;
    if (event.isoA2) byRegion.set(event.isoA2, (byRegion.get(event.isoA2) ?? 0) + 1);
    byCategory.set(event.category, (byCategory.get(event.category) ?? 0) + 1);
    for (const entity of event.entities ?? []) entities.set(entity, (entities.get(entity) ?? 0) + 1);
  }
  const topRegions = [...byRegion.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topCategories = [...byCategory.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
  const topEntities = [...entities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
  const critical = byTier.black + byTier.red;
  const summary = `${events.length} events in scope, ${critical} red/black, top tier ${maxTier}.`;
  return {
    summary,
    sections: [
      { title: "Severity posture", body: `Green ${byTier.green}, amber ${byTier.amber}, red ${byTier.red}, black ${byTier.black}.` },
      { title: "Regions in motion", body: topRegions.length ? topRegions.map(([iso, count]) => `${iso}: ${count}`).join(" · ") : "No regional concentration detected." },
      { title: "Issue mix", body: topCategories.length ? topCategories.map(([cat, count]) => `${cat}: ${count}`).join(" · ") : "No category concentration detected." },
      { title: "Entities to watch", body: topEntities.length ? topEntities.map(([entity, count]) => `${entity} (${count})`).join(" · ") : "No recurring named entities detected." },
    ],
  };
}

async function loadScopedEvents(
  ctx: MutationCtx,
  userId: UserId,
  scopeType: string,
  scopeValue: string | undefined,
  windowHours: number,
): Promise<Doc<"events">[]> {
  const cutoff = Date.now() - windowHours * 3_600_000;
  const rows = await ctx.db
    .query("events")
    .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
    .order("desc")
    .take(1000);
  const predicate = await scopePredicate(ctx, userId, scopeType, scopeValue);
  return rows.filter(predicate).slice(0, MAX_EVENTS);
}

async function citationPack(
  ctx: MutationCtx,
  events: Doc<"events">[],
) {
  const citations = [];
  const sourceItems = [];
  for (const event of events.slice(0, MAX_CITATIONS)) {
    const articles = await ctx.db
      .query("articles")
      .withIndex("by_event", (q) => q.eq("eventId", event._id))
      .take(1);
    const article = articles[0];
    if (!article) continue;
    sourceItems.push({ source: article.source, publishedAt: article.publishedAt });
    citations.push({
      index: citations.length + 1,
      articleId: String(article._id),
      eventId: String(event._id),
      title: article.title,
      source: article.source,
      url: article.url ?? null,
      quote: article.summary || event.summary,
      imageUrl: article.imageUrl ?? null,
    });
  }
  return { citations, provenance: summarizeSources(sourceItems) };
}

export const preview = query({
  args: { scopeType: scopeTypeValidator, scopeValue: v.optional(v.string()), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;
    const cutoff = Date.now() - windowHours * 3_600_000;
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
      .order("desc")
      .take(1000);
    const user = await getCurrentUser(ctx);
    const predicate = await scopePredicate(ctx, user?._id ?? null, args.scopeType, args.scopeValue);
    const events = rows.filter(predicate).slice(0, MAX_EVENTS);
    const brief = summarizeEvents(events);
    return { ...brief, eventCount: events.length, locked: true };
  },
});

export const generate = mutation({
  args: { scopeType: scopeTypeValidator, scopeValue: v.optional(v.string()), windowHours: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    requireFeature(user, "brief_generate");
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;
    const windowEnd = Date.now();
    const windowStart = windowEnd - windowHours * 3_600_000;
    const events = await loadScopedEvents(ctx, user._id, args.scopeType, args.scopeValue, windowHours);
    const brief = summarizeEvents(events);
    const { citations, provenance } = await citationPack(ctx, events);
    const titleScope = args.scopeValue ? `${args.scopeType}:${args.scopeValue}` : args.scopeType;
    const id = await ctx.db.insert("briefs", {
      userId: user._id,
      scopeType: args.scopeType,
      scopeValue: args.scopeValue,
      title: `MAPR brief · ${titleScope}`,
      summary: `${brief.summary} ${provenance.label}.`,
      sections: brief.sections,
      citations,
      windowStart,
      windowEnd,
      sourceEventIds: events.map((e) => e._id),
      status: citations.length > 0 ? "ready" : "partial",
      createdAt: windowEnd,
    });
    return await ctx.db.get(id);
  },
});

export const whatChanged = query({
  args: { scopeType: scopeTypeValidator, scopeValue: v.optional(v.string()), since: v.number() },
  handler: async (ctx, args) => {
    const now = Date.now();
    const rows = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.gte("publishedAt", args.since))
      .order("desc")
      .take(1000);
    const user = await getCurrentUser(ctx);
    const predicate = await scopePredicate(ctx, user?._id ?? null, args.scopeType, args.scopeValue);
    const events = rows.filter(predicate);
    const newEntities = new Map<string, number>();
    for (const event of events) for (const entity of event.entities ?? []) newEntities.set(entity, (newEntities.get(entity) ?? 0) + 1);
    return {
      since: args.since,
      until: now,
      eventCount: events.length,
      topEvents: events.slice(0, 8),
      entities: [...newEntities.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([entity, count]) => ({ entity, count })),
      summary: summarizeEvents(events).summary,
    };
  },
});

export const list = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("briefs")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.min(args.limit ?? 50, 100));
  },
});

export const get = query({
  args: { id: v.id("briefs") },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return null;
    const brief = await ctx.db.get(args.id);
    if (!brief || brief.userId !== user._id) return null;
    return brief;
  },
});

export const remove = mutation({
  args: { id: v.id("briefs") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const brief = await ctx.db.get(args.id);
    if (!brief || brief.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.delete(args.id);
    return { ok: true };
  },
});
