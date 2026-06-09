import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";
import { authTables } from "@convex-dev/auth/server";

/**
 * MAPR — Convex data model (Phase 1 lean core).
 *
 * Single source of truth (replaces InstantDB + Postgres/pgvector dual store).
 * - `events`  drive map markers + the deterministic composer filter.
 * - `articles` are the RAG corpus (native vectorIndex + searchIndex; BYO
 *   precomputed bge-m3 embeddings written by the Rust ingestor).
 *
 * Convex vector-search constraints honored:
 *   dims 1024 (bge-m3), <=16 equality filter fields, <=256 results, <=4 idx/table.
 *   Recency is equality-only -> `recencyBucket` filter field + publishedAt post-filter.
 */

// Severity tiers — mil-spec.
export const tierValidator = v.union(
  v.literal("green"),
  v.literal("amber"),
  v.literal("red"),
  v.literal("black"),
);

// Coarse recency buckets used as an *equality* vector-search filter field.
// (Convex vector filters cannot express ranges; we post-filter exact age.)
export const recencyBucketValidator = v.union(
  v.literal("h1"),
  v.literal("h6"),
  v.literal("h24"),
  v.literal("h72"),
  v.literal("h168"),
  v.literal("old"),
);

// Citation attached to an assistant QA message. Enforced + enriched server-side
// (see rag.ts) so the model can never invent an article that wasn't retrieved.
export const citationValidator = v.object({
  index: v.number(),
  articleId: v.string(),
  eventId: v.union(v.string(), v.null()),
  title: v.string(),
  source: v.string(),
  url: v.union(v.string(), v.null()),
  quote: v.union(v.string(), v.null()),
  imageUrl: v.optional(v.union(v.string(), v.null())),
});

// Email/alert digest schedule.
export const digestScheduleValidator = v.object({
  cadence: v.union(v.literal("daily"), v.literal("off")),
  hourUTC: v.number(),
});

export default defineSchema({
  // Convex Auth built-ins: sessions/accounts/refreshTokens/verificationCodes/…
  // (`users` from authTables is intentionally overridden below.)
  ...authTables,

  // App users — REPLACES the Convex Auth `users` table from authTables
  // (Convex Auth owns this table; we extend it with app/billing fields).
  users: defineTable({
    // Fields written by Convex Auth from the email/OAuth profile.
    name: v.optional(v.string()),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    image: v.optional(v.string()),
    emailVerificationTime: v.optional(v.number()),
    phoneVerificationTime: v.optional(v.number()),
    isAnonymous: v.optional(v.boolean()),
    // App/billing fields (server-of-record; client writes blocked).
    role: v.optional(v.union(v.literal("user"), v.literal("admin"))),
    subscriptionStatus: v.optional(v.string()), // "free" | "active" | "past_due" | "canceled"
    stripeCustomerId: v.optional(v.string()),
    // QA quota accounting (free 10 / pro 200 messages per trailing 30d window).
    qaWindowStart: v.optional(v.number()),
    qaWindowCount: v.optional(v.number()),
    createdAt: v.optional(v.number()),
  })
    // Convex Auth looks up users via an index literally named "email".
    .index("email", ["email"])
    .index("by_stripeCustomerId", ["stripeCustomerId"]),

  // ── Events: correlated clusters, plotted as map markers ──
  events: defineTable({
    externalId: v.string(), // stable correlation key (idempotent upsert)
    title: v.string(),
    summary: v.string(),
    isoA2: v.string(), // ISO-3166 alpha-2 (region) — "" if unlocated
    lon: v.number(),
    lat: v.number(),
    tier: tierValidator,
    severity: v.number(), // 0..10
    category: v.string(),
    status: v.union(v.literal("active"), v.literal("monitoring"), v.literal("resolved")),
    source: v.string(),
    url: v.optional(v.string()),
    articleCount: v.number(),
    publishedAt: v.number(), // ms epoch — most recent contributing article
    firstSeenAt: v.number(),
    lastUpdatedAt: v.number(),
    entities: v.optional(v.array(v.string())), // aggregated NER (people/orgs/places)
    imageUrl: v.optional(v.string()), // representative article image
    recencyBucket: recencyBucketValidator,
  })
    .index("by_externalId", ["externalId"])
    .index("by_publishedAt", ["publishedAt"])
    .index("by_iso", ["isoA2", "publishedAt"])
    .index("by_tier", ["tier", "publishedAt"]),

  // ── Articles: RAG corpus (native vector + full-text) ──
  articles: defineTable({
    externalId: v.string(), // dedup key
    eventId: v.optional(v.id("events")),
    eventKey: v.string(), // correlation key (matches events.externalId)
    title: v.string(),
    summary: v.string(),
    searchText: v.string(), // title + " " + summary (full-text field)
    source: v.string(),
    url: v.optional(v.string()),
    isoA2: v.string(),
    lon: v.number(),
    lat: v.number(),
    tier: tierValidator,
    severity: v.number(),
    category: v.string(),
    publishedAt: v.number(),
    entities: v.optional(v.array(v.string())), // NER (people/orgs/places) for the entity graph
    imageUrl: v.optional(v.string()), // representative news image for the article
    recencyBucket: recencyBucketValidator,
    // Hash of the embed text (title+summary). Lets the ingestor skip re-embedding
    // unchanged articles each cycle (only embed new/changed). Optional: rows
    // written before this field are treated as "changed" and re-embedded once.
    contentHash: v.optional(v.string()),
    embedding: v.array(v.float64()), // bge-m3, 1024-dim, normalized
  })
    .index("by_externalId", ["externalId"])
    .index("by_event", ["eventId"])
    .index("by_eventKey", ["eventKey"])
    .index("by_publishedAt", ["publishedAt"])
    .searchIndex("search_text", {
      searchField: "searchText",
      filterFields: ["isoA2", "recencyBucket", "category"],
    })
    .vectorIndex("by_embedding", {
      vectorField: "embedding",
      dimensions: 1024,
      filterFields: ["isoA2", "recencyBucket"],
    }),

  // ── Source ingestion catalog + health ──
  sourceCatalog: defineTable({
    name: v.string(),
    url: v.string(),
    kind: v.union(v.literal("gdelt"), v.literal("rss"), v.literal("html"), v.literal("bluesky")),
    enabled: v.boolean(),
    region: v.optional(v.string()),
    category: v.optional(v.string()),
    // Source-quality metadata. Optional for existing rows; backfilled lazily by
    // admin/source-request flows and treated as "other/mixed" when absent.
    sourceType: v.optional(v.union(
      v.literal("wire"),
      v.literal("regional"),
      v.literal("official"),
      v.literal("ngo"),
      v.literal("social"),
      v.literal("user"),
      v.literal("other"),
    )),
    verificationLevel: v.optional(v.union(v.literal("verified"), v.literal("mixed"), v.literal("unverified"))),
    countryOfOrigin: v.optional(v.string()),
    language: v.optional(v.string()),
    coverageRegion: v.optional(v.string()),
    // Health rollups updated by the Rust ingestor.
    lastFetchedAt: v.optional(v.number()),
    lastStatus: v.optional(v.string()), // "ok" | "warn" | "err"
    lastError: v.optional(v.string()),
    consecutiveFailures: v.number(),
    // Set when the scheduled maintenance job auto-disables a persistently-failing
    // feed. Distinguishes auto-disabled (probe may recover) from admin-disabled
    // (left alone). Cleared on recovery or manual re-enable.
    autoDisabledAt: v.optional(v.number()),
    fetchCount: v.number(),
    itemCount: v.number(),
    createdAt: v.number(),
  })
    .index("by_url", ["url"])
    .index("by_enabled", ["enabled"]),

  // Feature flags (admin-editable, public-readable subset).
  featureFlags: defineTable({
    key: v.string(),
    value: v.boolean(),
    description: v.optional(v.string()),
    updatedAt: v.number(),
  }).index("by_key", ["key"]),

  // Control signals — Rust ingestor polls `refreshRequested`.
  controlSignals: defineTable({
    key: v.string(), // e.g. "refreshRequested"
    value: v.boolean(),
    requestedBy: v.optional(v.string()),
    requestedAt: v.number(),
    consumedAt: v.optional(v.number()),
  }).index("by_key", ["key"]),

  // ── User-owned collections ──
  savedViews: defineTable({
    userId: v.id("users"),
    name: v.string(),
    description: v.optional(v.string()),
    filterState: v.string(), // JSON-serialized UI filter state
    mapState: v.string(), // JSON-serialized map state (mode/center/zoom)
    pinned: v.optional(v.boolean()),
    shareToken: v.optional(v.string()),
    createdAt: v.number(),
    updatedAt: v.number(),
  })
    .index("by_user", ["userId"])
    .index("by_shareToken", ["shareToken"]),

  alertRules: defineTable({
    userId: v.id("users"),
    name: v.string(),
    severityThreshold: v.number(),
    minConfidence: v.optional(v.number()),
    savedViewId: v.optional(v.id("savedViews")),
    isoA2: v.optional(v.string()),
    category: v.optional(v.string()),
    keyword: v.optional(v.string()),
    channels: v.optional(v.array(v.string())), // e.g. ["email","inapp"]
    emailAddress: v.optional(v.string()),
    digestSchedule: v.optional(digestScheduleValidator),
    active: v.boolean(),
    lastTriggeredAt: v.optional(v.number()),
    lastDigestSentAt: v.optional(v.number()),
    createdAt: v.number(),
  }).index("by_user", ["userId"]),

  // ── Phase 2: frozen per-watch baseline snapshot (NET-NEW infra) ──
  // NOT the rolling computeAnomalies delta. A standing watch freezes a baseline
  // event-set + severity rollup on create; each ingest cycle diffs against it.
  watchBaselines: defineTable({
    userId: v.id("users"),
    watchlistItemId: v.id("watchlistItems"), // the watch this baseline freezes
    scopeType: v.union(v.literal("region"), v.literal("entity"), v.literal("keyword")),
    scopeValue: v.string(), // isoA2 | entity | keyword (mirrors watchlistItems.type/value)
    windowHours: v.number(), // baseline lookback window at snapshot time
    snapshotAt: v.number(), // freeze timestamp
    baselineEventKeys: v.array(v.string()), // frozen event-key set (events.externalId)
    baselineEventCount: v.number(),
    baselineSeverityAvg: v.number(),
    baselineTierCounts: v.object({
      green: v.number(),
      amber: v.number(),
      red: v.number(),
      black: v.number(),
    }),
    lastDiffAt: v.optional(v.number()), // last time diff ran for this baseline
  })
    .index("by_user", ["userId"])
    .index("by_watch", ["watchlistItemId"]),

  // ── Phase 2: in-app alert stream (NET-NEW, B2) ──
  // Per-cycle watch evaluation writes a DETERMINISTIC diff summary here when a
  // watch fires (new events vs the frozen baseline). Prose synthesis is NOT
  // written here — it is generated only on explicit user click (rag), so bursty
  // ingest cycles never queue LLM generations. The SIGNALS drawer subscribes.
  alertStream: defineTable({
    userId: v.id("users"),
    watchlistItemId: v.id("watchlistItems"),
    kind: v.literal("watch_fired"),
    // Deterministic diff summary (counts + a capped sample of new events).
    payload: v.object({
      label: v.string(),
      newCount: v.number(),
      resolvedCount: v.number(),
      escalatedCount: v.number(),
      severityDelta: v.number(),
      sample: v.array(
        v.object({
          eventKey: v.string(),
          eventId: v.string(),
          title: v.string(),
          isoA2: v.string(),
          tier: tierValidator,
          severity: v.number(),
        }),
      ),
    }),
    createdAt: v.number(),
    seenAt: v.optional(v.number()),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_watch", ["watchlistItemId", "createdAt"]),

  watchlistItems: defineTable({
    userId: v.id("users"),
    type: v.string(), // "region" | "entity" | "keyword"
    value: v.string(),
    label: v.string(),
    addedAt: v.number(),
    digestSchedule: v.optional(digestScheduleValidator),
    lastDigestSentAt: v.optional(v.number()),
    lastMatchAt: v.optional(v.number()),
    matchCount: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_value", ["userId", "type", "value"]),

  bookmarks: defineTable({
    userId: v.id("users"),
    eventId: v.optional(v.id("events")),
    storyId: v.string(),
    storyTitle: v.string(),
    storySummary: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    note: v.optional(v.string()),
    region: v.string(),
    severity: v.number(),
    bookmarkedAt: v.number(),
    updatedAt: v.optional(v.number()),
  })
    .index("by_user", ["userId"])
    .index("by_user_story", ["userId", "storyId"]),

  // ── AI Q&A (server-only message writes) ──
  qaConversations: defineTable({
    userId: v.id("users"),
    title: v.string(),
    archived: v.optional(v.boolean()),
    messageCount: v.number(),
    lastMessageAt: v.optional(v.number()),
    createdAt: v.number(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),

  qaMessages: defineTable({
    conversationId: v.id("qaConversations"),
    userId: v.id("users"),
    role: v.union(v.literal("user"), v.literal("assistant")),
    content: v.string(),
    citations: v.optional(v.array(citationValidator)),
    modelUsed: v.optional(v.string()),
    tokensIn: v.optional(v.number()),
    tokensOut: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_conversation", ["conversationId", "createdAt"])
    .index("by_user_created", ["userId", "createdAt"]),

  // ── Analyst work products: briefs, cases, exports, source requests ──
  briefs: defineTable({
    userId: v.id("users"),
    scopeType: v.union(
      v.literal("global"),
      v.literal("region"),
      v.literal("entity"),
      v.literal("watchlist"),
      v.literal("savedView"),
      v.literal("case"),
    ),
    scopeValue: v.optional(v.string()),
    title: v.string(),
    summary: v.string(),
    sections: v.array(v.object({
      title: v.string(),
      body: v.string(),
    })),
    citations: v.array(citationValidator),
    windowStart: v.number(),
    windowEnd: v.number(),
    sourceEventIds: v.array(v.id("events")),
    status: v.union(v.literal("ready"), v.literal("partial"), v.literal("failed")),
    createdAt: v.number(),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_scope", ["userId", "scopeType", "scopeValue", "createdAt"]),

  cases: defineTable({
    userId: v.id("users"),
    title: v.string(),
    description: v.optional(v.string()),
    status: v.union(v.literal("active"), v.literal("archived")),
    createdAt: v.number(),
    updatedAt: v.number(),
    lastBriefAt: v.optional(v.number()),
  }).index("by_user", ["userId", "updatedAt"]),

  caseItems: defineTable({
    caseId: v.id("cases"),
    userId: v.id("users"),
    type: v.union(v.literal("event"), v.literal("article"), v.literal("entity"), v.literal("region"), v.literal("note")),
    eventId: v.optional(v.id("events")),
    articleId: v.optional(v.id("articles")),
    entity: v.optional(v.string()),
    region: v.optional(v.string()),
    note: v.optional(v.string()),
    title: v.string(),
    summary: v.optional(v.string()),
    source: v.optional(v.string()),
    url: v.optional(v.string()),
    severity: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_case", ["caseId", "createdAt"])
    .index("by_user", ["userId", "createdAt"]),

  sourceRequests: defineTable({
    userId: v.id("users"),
    name: v.string(),
    url: v.string(),
    reason: v.string(),
    region: v.optional(v.string()),
    category: v.optional(v.string()),
    status: v.union(v.literal("pending"), v.literal("approved"), v.literal("rejected")),
    adminNote: v.optional(v.string()),
    createdAt: v.number(),
    reviewedAt: v.optional(v.number()),
    reviewedBy: v.optional(v.id("users")),
  })
    .index("by_user", ["userId", "createdAt"])
    .index("by_status", ["status", "createdAt"]),

  // ── Stripe webhook idempotency ledger ──
  stripeEvents: defineTable({
    eventId: v.string(),
    type: v.string(),
    status: v.union(v.literal("processed"), v.literal("failed")),
    receivedAt: v.number(),
  }).index("by_eventId", ["eventId"]),

  // ── Coverage rollups (region density) — used by /admin + P2 region pages ──
  coverage: defineTable({
    isoA2: v.string(),
    eventCount: v.number(),
    avgSeverity: v.number(),
    topTier: tierValidator,
    updatedAt: v.number(),
  }).index("by_iso", ["isoA2"]),

  // Migration staging: Stripe customer/status keyed by email, applied to the
  // user row on first sign-in (auth.afterUserCreatedOrUpdated).
  pendingBilling: defineTable({
    email: v.string(),
    stripeCustomerId: v.string(),
    subscriptionStatus: v.string(),
    createdAt: v.number(),
  }).index("by_email", ["email"]),
});
