import { mutation, query, internalMutation, internalQuery, internalAction } from "./_generated/server";
import type { QueryCtx } from "./_generated/server";
import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { requireUser, getCurrentUser } from "./lib/access";
import { limitsForUser } from "./lib/entitlements";
import { digestScheduleValidator } from "./schema";
import { watchlistMatchesEvent } from "./digests";

/**
 * Phase 2 standing watches (BACKEND B1).
 *
 * A watch freezes a *baseline* event-set + severity rollup on create
 * (`watchBaselines`, NET-NEW). Each ingest cycle diffs the live scope against
 * that frozen snapshot → a deterministic Change Report. This is NOT the rolling
 * `computeAnomalies` delta; it is a per-user frozen reference point.
 *
 * Deterministic facts (counts, new/resolved/escalated event sets, severity
 * deltas) are computed in CODE here. Prose synthesis is gated behind an explicit
 * user click (rag, B2) and is intentionally absent from `diffWatch`.
 */

const DEFAULT_WINDOW_HOURS = 168; // 7d

type TierCounts = { green: number; amber: number; red: number; black: number };

const scopeTypeValidator = v.union(
  v.literal("region"),
  v.literal("entity"),
  v.literal("keyword"),
);

// Bound on the live scope event-set read. Entity/keyword scopes have no covering
// index, so they scan the recency window; region scopes use `by_iso` and only
// read their own region's events, so this cap is effectively never hit there.
const SCOPE_SCAN_LIMIT = 1000;

/** Fetch + filter the live event set for a watch scope over a lookback window. */
async function loadScopeEvents(
  ctx: QueryCtx,
  type: string,
  value: string,
  windowHours: number,
): Promise<Doc<"events">[]> {
  const cutoff = Date.now() - windowHours * 3_600_000;

  // Region scopes: drive off `by_iso` so each watch reads ONLY its region's
  // events in the window instead of scanning + filtering the global recency
  // window. isoA2 stored upper-case on events; scope value mirrors that.
  if (type === "region") {
    const iso = value.toUpperCase();
    return await ctx.db
      .query("events")
      .withIndex("by_iso", (q) => q.eq("isoA2", iso).gte("publishedAt", cutoff))
      .order("desc")
      .take(SCOPE_SCAN_LIMIT);
  }

  // Entity/keyword scopes have no covering index — bounded recency-window scan.
  const events = await ctx.db
    .query("events")
    .withIndex("by_publishedAt", (q) => q.gte("publishedAt", cutoff))
    .order("desc")
    .take(SCOPE_SCAN_LIMIT);
  return events.filter((e) => watchlistMatchesEvent(e, type, value));
}

/** Deterministic severity rollup for a frozen / live event set. */
function rollup(events: Doc<"events">[]): {
  eventKeys: string[];
  count: number;
  severityAvg: number;
  tierCounts: TierCounts;
} {
  const tierCounts: TierCounts = { green: 0, amber: 0, red: 0, black: 0 };
  let severitySum = 0;
  const eventKeys: string[] = [];
  for (const e of events) {
    eventKeys.push(e.externalId);
    severitySum += e.severity;
    tierCounts[e.tier] += 1;
  }
  return {
    eventKeys,
    count: events.length,
    severityAvg: events.length ? severitySum / events.length : 0,
    tierCounts,
  };
}

const TIER_RANK: Record<Doc<"events">["tier"], number> = {
  green: 0,
  amber: 1,
  red: 2,
  black: 3,
};

/**
 * createWatchWithBaseline — create a standing watch + freeze its baseline.
 * REUSES watchlist.add dedupe semantics (by_user_value) + entitlement limits.
 */
export const createWatchWithBaseline = mutation({
  args: {
    type: scopeTypeValidator,
    value: v.string(),
    label: v.string(),
    windowHours: v.optional(v.number()),
    digestSchedule: v.optional(digestScheduleValidator),
  },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const windowHours = args.windowHours ?? DEFAULT_WINDOW_HOURS;

    // 1. REUSE watchlist.add semantics: dedupe via by_user_value, enforce limits.
    let watchlistItemId = (
      await ctx.db
        .query("watchlistItems")
        .withIndex("by_user_value", (q) =>
          q.eq("userId", user._id).eq("type", args.type).eq("value", args.value),
        )
        .unique()
    )?._id;

    if (!watchlistItemId) {
      const limits = limitsForUser(user);
      if (limits.watchlists !== Number.MAX_SAFE_INTEGER) {
        const current = await ctx.db
          .query("watchlistItems")
          .withIndex("by_user", (q) => q.eq("userId", user._id))
          .take(limits.watchlists + 1);
        if (current.length >= limits.watchlists) throw new Error("FEATURE_LIMIT_WATCHLIST");
      }
      watchlistItemId = await ctx.db.insert("watchlistItems", {
        userId: user._id,
        type: args.type,
        value: args.value,
        label: args.label,
        addedAt: Date.now(),
        digestSchedule: args.digestSchedule,
      });
    }

    // 2. Compute the frozen baseline over the lookback window.
    const scopeEvents = await loadScopeEvents(ctx, args.type, args.value, windowHours);
    const roll = rollup(scopeEvents);
    const snapshotAt = Date.now();

    // Idempotency: if a baseline already exists for this watch, re-freeze it.
    const existingBaseline = await ctx.db
      .query("watchBaselines")
      .withIndex("by_watch", (q) => q.eq("watchlistItemId", watchlistItemId!))
      .unique();

    const baselineFields = {
      userId: user._id,
      watchlistItemId,
      scopeType: args.type,
      scopeValue: args.value,
      windowHours,
      snapshotAt,
      baselineEventKeys: roll.eventKeys,
      baselineEventCount: roll.count,
      baselineSeverityAvg: roll.severityAvg,
      baselineTierCounts: roll.tierCounts,
    };

    let baselineId;
    if (existingBaseline) {
      await ctx.db.patch(existingBaseline._id, { ...baselineFields, lastDiffAt: undefined });
      baselineId = existingBaseline._id;
    } else {
      baselineId = await ctx.db.insert("watchBaselines", baselineFields);
    }

    return { watchlistItemId, baselineId, baselineEventCount: roll.count };
  },
});

export interface WatchDiff {
  baselineAt: number;
  baselineEventCount: number;
  currentEventCount: number;
  newEvents: {
    eventKey: string;
    eventId: string;
    title: string;
    isoA2: string;
    tier: Doc<"events">["tier"];
    severity: number;
    firstSeenAt: number;
  }[];
  resolvedEvents: { eventKey: string }[];
  escalatedEvents: {
    eventKey: string;
    eventId: string;
    toTier: Doc<"events">["tier"];
    severity: number;
  }[];
  severityDelta: number;
  tierCountDelta: TierCounts;
}

/**
 * Pure deterministic diff of a live scope event-set against a frozen baseline.
 * Shared by `diffWatch` (auth query) and `sweepWatches` (cron, B2) so the
 * on-demand report and the per-cycle fire signal compute identically.
 */
function computeWatchDiff(baseline: Doc<"watchBaselines">, current: Doc<"events">[]): WatchDiff {
  const currentRoll = rollup(current);
  const baselineKeySet = new Set(baseline.baselineEventKeys);
  const currentKeySet = new Set(current.map((e) => e.externalId));

  // New: present now, absent from baseline, and genuinely seen after snapshot.
  const newEvents = current
    .filter((e) => !baselineKeySet.has(e.externalId) && e.firstSeenAt > baseline.snapshotAt)
    .map((e) => ({
      eventKey: e.externalId,
      eventId: String(e._id),
      title: e.title,
      isoA2: e.isoA2,
      tier: e.tier,
      severity: e.severity,
      firstSeenAt: e.firstSeenAt,
    }));

  // Resolved: in baseline, absent from the live set (aged out / resolved).
  const resolvedEvents = baseline.baselineEventKeys
    .filter((k) => !currentKeySet.has(k))
    .map((k) => ({ eventKey: k }));

  // Escalated: persisted key whose live tier is now red/black — the
  // deterministic escalation signal (baseline freezes keys, not per-event sev).
  const escalatedEvents: WatchDiff["escalatedEvents"] = [];
  for (const e of current) {
    if (!baselineKeySet.has(e.externalId)) continue;
    if (TIER_RANK[e.tier] >= TIER_RANK.red) {
      escalatedEvents.push({
        eventKey: e.externalId,
        eventId: String(e._id),
        toTier: e.tier,
        severity: e.severity,
      });
    }
  }

  const tierCountDelta: TierCounts = {
    green: currentRoll.tierCounts.green - baseline.baselineTierCounts.green,
    amber: currentRoll.tierCounts.amber - baseline.baselineTierCounts.amber,
    red: currentRoll.tierCounts.red - baseline.baselineTierCounts.red,
    black: currentRoll.tierCounts.black - baseline.baselineTierCounts.black,
  };

  return {
    baselineAt: baseline.snapshotAt,
    baselineEventCount: baseline.baselineEventCount,
    currentEventCount: currentRoll.count,
    newEvents,
    resolvedEvents,
    escalatedEvents,
    severityDelta: currentRoll.severityAvg - baseline.baselineSeverityAvg,
    tierCountDelta,
  };
}

/**
 * diffWatch — the deterministic Baseline Diff Report.
 * Diffs the live scope against the frozen baseline. NO prose (B2 on click).
 */
export const diffWatch = query({
  args: { watchlistItemId: v.id("watchlistItems") },
  handler: async (ctx, args): Promise<WatchDiff> => {
    const user = await requireUser(ctx);
    const watch = await ctx.db.get(args.watchlistItemId);
    if (!watch || watch.userId !== user._id) throw new Error("FORBIDDEN");

    const baseline = await ctx.db
      .query("watchBaselines")
      .withIndex("by_watch", (q) => q.eq("watchlistItemId", args.watchlistItemId))
      .unique();
    if (!baseline) throw new Error("NO_BASELINE");

    const current = await loadScopeEvents(
      ctx,
      baseline.scopeType,
      baseline.scopeValue,
      baseline.windowHours,
    );
    return computeWatchDiff(baseline, current);
  },
});

/**
 * resnapshotBaseline — re-freeze the baseline (e.g. after "mark as seen" or a
 * cadence rollover) so the next diff measures from a fresh reference point.
 */
export const resnapshotBaseline = internalMutation({
  args: { watchlistItemId: v.id("watchlistItems") },
  handler: async (ctx, args) => {
    const baseline = await ctx.db
      .query("watchBaselines")
      .withIndex("by_watch", (q) => q.eq("watchlistItemId", args.watchlistItemId))
      .unique();
    if (!baseline) throw new Error("NO_BASELINE");

    const scopeEvents = await loadScopeEvents(
      ctx,
      baseline.scopeType,
      baseline.scopeValue,
      baseline.windowHours,
    );
    const roll = rollup(scopeEvents);
    const snapshotAt = Date.now();

    await ctx.db.patch(baseline._id, {
      snapshotAt,
      baselineEventKeys: roll.eventKeys,
      baselineEventCount: roll.count,
      baselineSeverityAvg: roll.severityAvg,
      baselineTierCounts: roll.tierCounts,
      lastDiffAt: undefined,
    });

    return { baselineId: baseline._id, baselineEventCount: roll.count, snapshotAt };
  },
});

// ── B2: per-cycle watch evaluation → in-app alert stream ────────────────────
//
// `sweepWatches` runs each ingest cycle (registered in crons.ts). Per watch it
// runs the DETERMINISTIC diff against the frozen baseline and, when there are
// new-since-baseline events, writes a deterministic summary to `alertStream`
// and stamps any matching alertRules.lastTriggeredAt. It NEVER invokes the LLM:
// prose synthesis stays gated behind an explicit user click (REDESIGN §7 Risk 1),
// so bursty 15-min cycles can't queue many 3B generations.

// Per-page baseline read for the paginated sweep. Each page is one transaction;
// the action loops pages via the continue-cursor until exhausted, so the sweep
// covers ALL baselines (not a hard-capped first 500).
const SWEEP_PAGE_SIZE = 200;

/** Run the deterministic diff for one watch (no auth — internal sweep use). */
export const diffWatchForSweep = internalQuery({
  args: { watchlistItemId: v.id("watchlistItems") },
  handler: async (ctx, args): Promise<(WatchDiff & { userId: Id<"users">; scopeType: string; scopeValue: string; label: string }) | null> => {
    const baseline = await ctx.db
      .query("watchBaselines")
      .withIndex("by_watch", (q) => q.eq("watchlistItemId", args.watchlistItemId))
      .unique();
    if (!baseline) return null;
    const watch = await ctx.db.get(args.watchlistItemId);
    if (!watch) return null;

    const current = await loadScopeEvents(
      ctx,
      baseline.scopeType,
      baseline.scopeValue,
      baseline.windowHours,
    );
    const diff = computeWatchDiff(baseline, current);
    return {
      ...diff,
      userId: baseline.userId,
      scopeType: baseline.scopeType,
      scopeValue: baseline.scopeValue,
      label: watch.label,
    };
  },
});

/** A fire-eligible sweep result (new-since-baseline events present). */
type SweepFire = {
  watchlistItemId: Id<"watchlistItems">;
  userId: Id<"users">;
  scopeType: "region" | "entity" | "keyword";
  scopeValue: string;
  label: string;
  newCount: number;
  resolvedCount: number;
  escalatedCount: number;
  severityDelta: number;
  sample: {
    eventKey: string;
    eventId: string;
    title: string;
    isoA2: string;
    tier: Doc<"events">["tier"];
    severity: number;
  }[];
};

/**
 * Diff one PAGE of baselines, grouping identical scopes so the live scope
 * event-set is loaded ONCE per distinct (scopeType, scopeValue, windowHours)
 * — not once per watch. Returns only fire-eligible results plus the next cursor
 * so `sweepWatches` can page through every baseline. The diff + fire semantics
 * are byte-identical to `diffWatchForSweep`; this only deduplicates scope reads.
 */
export const sweepBatch = internalQuery({
  args: { cursor: v.union(v.string(), v.null()) },
  handler: async (
    ctx,
    args,
  ): Promise<{ fires: SweepFire[]; scanned: number; continueCursor: string; isDone: boolean }> => {
    const page = await ctx.db
      .query("watchBaselines")
      .paginate({ numItems: SWEEP_PAGE_SIZE, cursor: args.cursor });

    // Group identical scopes → load each scope's event-set exactly once.
    const scopeCache = new Map<string, Doc<"events">[]>();
    const fires: SweepFire[] = [];

    for (const baseline of page.page) {
      const scopeKey = `${baseline.scopeType} ${baseline.scopeValue.toLowerCase()} ${baseline.windowHours}`;
      let current = scopeCache.get(scopeKey);
      if (!current) {
        current = await loadScopeEvents(
          ctx,
          baseline.scopeType,
          baseline.scopeValue,
          baseline.windowHours,
        );
        scopeCache.set(scopeKey, current);
      }

      const diff = computeWatchDiff(baseline, current);
      if (diff.newEvents.length === 0) continue; // deterministic gate: only fire on new events

      const watch = await ctx.db.get(baseline.watchlistItemId);
      if (!watch) continue;

      fires.push({
        watchlistItemId: baseline.watchlistItemId,
        userId: baseline.userId,
        scopeType: baseline.scopeType,
        scopeValue: baseline.scopeValue,
        label: watch.label,
        newCount: diff.newEvents.length,
        resolvedCount: diff.resolvedEvents.length,
        escalatedCount: diff.escalatedEvents.length,
        severityDelta: diff.severityDelta,
        sample: diff.newEvents.slice(0, 8).map((e) => ({
          eventKey: e.eventKey,
          eventId: e.eventId,
          title: e.title,
          isoA2: e.isoA2,
          tier: e.tier,
          severity: e.severity,
        })),
      });
    }

    return {
      fires,
      scanned: page.page.length,
      continueCursor: page.continueCursor,
      isDone: page.isDone,
    };
  },
});

const fireSampleValidator = v.array(
  v.object({
    eventKey: v.string(),
    eventId: v.string(),
    title: v.string(),
    isoA2: v.string(),
    tier: v.union(v.literal("green"), v.literal("amber"), v.literal("red"), v.literal("black")),
    severity: v.number(),
  }),
);

/**
 * Write a deterministic watch-fired signal: insert an `alertStream` row, stamp
 * the baseline's `lastDiffAt`, and set `lastTriggeredAt` on the user's alert
 * rules whose scope matches this watch (region→isoA2 / keyword→keyword).
 */
export const recordWatchFire = internalMutation({
  args: {
    userId: v.id("users"),
    watchlistItemId: v.id("watchlistItems"),
    scopeType: v.union(v.literal("region"), v.literal("entity"), v.literal("keyword")),
    scopeValue: v.string(),
    label: v.string(),
    newCount: v.number(),
    resolvedCount: v.number(),
    escalatedCount: v.number(),
    severityDelta: v.number(),
    sample: fireSampleValidator,
  },
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("alertStream", {
      userId: args.userId,
      watchlistItemId: args.watchlistItemId,
      kind: "watch_fired",
      payload: {
        label: args.label,
        newCount: args.newCount,
        resolvedCount: args.resolvedCount,
        escalatedCount: args.escalatedCount,
        severityDelta: args.severityDelta,
        sample: args.sample,
      },
      createdAt: now,
    });

    const baseline = await ctx.db
      .query("watchBaselines")
      .withIndex("by_watch", (q) => q.eq("watchlistItemId", args.watchlistItemId))
      .unique();
    if (baseline) await ctx.db.patch(baseline._id, { lastDiffAt: now });

    // REUSE alertRules.lastTriggeredAt: stamp the user's matching scoped rules.
    const rules = await ctx.db
      .query("alertRules")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .collect();
    for (const r of rules) {
      if (!r.active) continue;
      const matches =
        (args.scopeType === "region" && r.isoA2 && r.isoA2.toUpperCase() === args.scopeValue.toUpperCase()) ||
        (args.scopeType === "keyword" && r.keyword && r.keyword.toLowerCase() === args.scopeValue.toLowerCase());
      if (matches) await ctx.db.patch(r._id, { lastTriggeredAt: now });
    }

    return { ok: true };
  },
});

/**
 * sweepWatches — cron entrypoint (B2). Deterministic per-cycle evaluation.
 * No LLM. Fires `alertStream` rows for watches with new-since-baseline events.
 *
 * Pages through EVERY baseline via a cursor loop (no 500-row cap), and within
 * each page identical scopes share a single scope-event read. Each page is its
 * own read transaction, so a large watch population is swept in bounded steps.
 */
export const sweepWatches = internalAction({
  args: {},
  returns: v.object({ watches: v.number(), fired: v.number() }),
  handler: async (ctx): Promise<{ watches: number; fired: number }> => {
    let cursor: string | null = null;
    let watches = 0;
    let fired = 0;

    // Hard safety bound on page iterations (page size × max pages) so a cursor
    // anomaly can never spin forever; well above any realistic baseline count.
    const MAX_PAGES = 10_000;
    for (let pageNo = 0; pageNo < MAX_PAGES; pageNo++) {
      const batch: { fires: SweepFire[]; scanned: number; continueCursor: string; isDone: boolean } =
        await ctx.runQuery(internal.watchBaselines.sweepBatch, { cursor });
      watches += batch.scanned;
      for (const fire of batch.fires) {
        await ctx.runMutation(internal.watchBaselines.recordWatchFire, {
          userId: fire.userId,
          watchlistItemId: fire.watchlistItemId,
          scopeType: fire.scopeType,
          scopeValue: fire.scopeValue,
          label: fire.label,
          newCount: fire.newCount,
          resolvedCount: fire.resolvedCount,
          escalatedCount: fire.escalatedCount,
          severityDelta: fire.severityDelta,
          sample: fire.sample,
        });
        fired++;
      }
      if (batch.isDone) break;
      cursor = batch.continueCursor;
    }

    return { watches, fired };
  },
});

/** SIGNALS drawer feed — the current user's watch-fired stream (newest first). */
export const listSignals = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const user = await getCurrentUser(ctx);
    if (!user) return [];
    return await ctx.db
      .query("alertStream")
      .withIndex("by_user", (q) => q.eq("userId", user._id))
      .order("desc")
      .take(Math.max(1, Math.min(100, args.limit ?? 50)));
  },
});

/** Mark a signal as seen (clears the unread badge in the SIGNALS drawer). */
export const markSignalSeen = mutation({
  args: { id: v.id("alertStream") },
  handler: async (ctx, args) => {
    const user = await requireUser(ctx);
    const row = await ctx.db.get(args.id);
    if (!row || row.userId !== user._id) throw new Error("FORBIDDEN");
    await ctx.db.patch(args.id, { seenAt: Date.now() });
    return { ok: true };
  },
});
