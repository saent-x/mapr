import { mutation, query, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import type { MutationCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { tierValidator } from "./schema";
import { recencyBucket } from "./lib/recency";
import { assertIngestKey } from "./lib/access";

type Tier = Doc<"events">["tier"];
const TIER_RANK: Record<Tier, number> = { green: 1, amber: 2, red: 3, black: 4 };

// Standard rollup window for the precomputed per-region `coverage` table — must
// match events.DEFAULT_WINDOW_HOURS so events.regionCoverage can read the
// rollup for its default window instead of re-scanning all events per client.
const COVERAGE_WINDOW_HOURS = 168;
// Cap the per-iso rescan so one batch can't blow the per-transaction read
// budget when a single region is unusually dense; the count is still exact up
// to this bound and far above any real per-region event volume in the window.
const COVERAGE_SCAN_LIMIT = 5000;

/**
 * Recompute the precomputed `coverage` rollup for each region touched this
 * batch, over the standard 168h window. Runs once per ingest write — moving the
 * full-window region scan off the hot read path so `events.regionCoverage`
 * (subscribed by every client) is O(regions) instead of O(all events).
 *
 * Each touched region's row is recomputed EXACTLY against the live window. A
 * region only goes stale if it stops being ingested entirely while its events
 * age out (the row then over-counts until `pruneOld` deletes those events or
 * the region is touched again) — a safe over-estimate that never hides
 * coverage; active regions are refreshed every cycle.
 */
async function recomputeCoverage(ctx: MutationCtx, isoA2s: Set<string>, now: number): Promise<void> {
  const cutoff = now - COVERAGE_WINDOW_HOURS * 3_600_000;
  for (const isoA2 of isoA2s) {
    if (!isoA2) continue; // unlocated events never tint a region
    const events = await ctx.db
      .query("events")
      .withIndex("by_iso", (q) => q.eq("isoA2", isoA2).gte("publishedAt", cutoff))
      .take(COVERAGE_SCAN_LIMIT);

    const existing = await ctx.db
      .query("coverage")
      .withIndex("by_iso", (q) => q.eq("isoA2", isoA2))
      .unique();

    if (events.length === 0) {
      // Region drained out of the window — drop its stale rollup row.
      if (existing) await ctx.db.delete(existing._id);
      continue;
    }

    let sevSum = 0;
    let topTier: Tier = "green";
    for (const e of events) {
      sevSum += e.severity;
      if (TIER_RANK[e.tier] > TIER_RANK[topTier]) topTier = e.tier;
    }
    const row = {
      isoA2,
      eventCount: events.length,
      avgSeverity: sevSum / events.length,
      topTier,
      updatedAt: now,
    };
    if (existing) await ctx.db.patch(existing._id, row);
    else await ctx.db.insert("coverage", row);
  }
}

const articleInput = v.object({
  externalId: v.string(),
  eventKey: v.string(),
  title: v.string(),
  summary: v.string(),
  source: v.string(),
  url: v.optional(v.string()),
  isoA2: v.string(),
  lon: v.number(),
  lat: v.number(),
  tier: tierValidator,
  severity: v.number(),
  category: v.string(),
  publishedAt: v.number(),
  entities: v.optional(v.array(v.string())),
  imageUrl: v.optional(v.string()),
  // Hash of the embed text (title+summary). The ingestor sends it so this row
  // records what was embedded; on the next cycle it can compare against
  // `articles.contentHashesByExternalIds` and skip re-embedding when unchanged.
  // Optional: older ingestor builds that omit it still write successfully.
  contentHash: v.optional(v.string()),
  embedding: v.array(v.float64()),
});

const EMBEDDING_DIMS = 1024;

function pickRepresentative(articles: Doc<"articles">[]): Doc<"articles"> {
  // Most severe, then most recent — drives the event's marker + headline.
  return articles.reduce((best, a) => {
    if (a.severity > best.severity) return a;
    if (a.severity === best.severity && a.publishedAt > best.publishedAt) return a;
    return best;
  }, articles[0]);
}

/** Union the cluster's article entities, keeping the most frequent (top 12). */
function aggregateEntities(articles: Doc<"articles">[]): string[] {
  const counts = new Map<string, number>();
  for (const a of articles) {
    for (const e of a.entities ?? []) counts.set(e, (counts.get(e) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1])
    .slice(0, 12)
    .map(([name]) => name);
}

async function recomputeEvent(
  ctx: MutationCtx,
  eventKey: string,
  now: number,
): Promise<{ id: Id<"events">; isoA2: string; prevIsoA2?: string } | null> {
  const articles = await ctx.db
    .query("articles")
    .withIndex("by_eventKey", (q) => q.eq("eventKey", eventKey))
    .collect();
  if (articles.length === 0) return null;

  const rep = pickRepresentative(articles);
  const topTier = articles.reduce<Tier>((t, a) => (TIER_RANK[a.tier] > TIER_RANK[t] ? a.tier : t), "green");
  const maxSeverity = articles.reduce((m, a) => Math.max(m, a.severity), 0);
  const publishedAt = articles.reduce((m, a) => Math.max(m, a.publishedAt), 0);
  const firstSeen = articles.reduce((m, a) => Math.min(m, a.publishedAt), Number.MAX_SAFE_INTEGER);
  const ageMs = now - publishedAt;
  const status: Doc<"events">["status"] =
    ageMs <= 24 * 3_600_000 ? "active" : ageMs <= 7 * 24 * 3_600_000 ? "monitoring" : "resolved";

  const existing = await ctx.db
    .query("events")
    .withIndex("by_externalId", (q) => q.eq("externalId", eventKey))
    .unique();

  const fields = {
    externalId: eventKey,
    title: rep.title,
    summary: rep.summary,
    isoA2: rep.isoA2,
    lon: rep.lon,
    lat: rep.lat,
    tier: topTier,
    severity: maxSeverity,
    category: rep.category,
    status,
    source: rep.source,
    url: rep.url,
    articleCount: articles.length,
    publishedAt,
    lastUpdatedAt: now,
    entities: aggregateEntities(articles),
    imageUrl: rep.imageUrl,
    recencyBucket: recencyBucket(publishedAt, now),
  };

  let eventId: Id<"events">;
  if (existing) {
    await ctx.db.patch(existing._id, fields);
    eventId = existing._id;
  } else {
    eventId = await ctx.db.insert("events", { ...fields, firstSeenAt: firstSeen });
  }

  // Backfill eventId onto any articles missing it.
  for (const a of articles) {
    if (a.eventId !== eventId) await ctx.db.patch(a._id, { eventId });
  }
  // Surface BOTH the new region and any prior region this event moved away
  // from, so the coverage rollup is recomputed for each affected region.
  if (existing && existing.isoA2 && existing.isoA2 !== fields.isoA2) {
    return { id: eventId, isoA2: fields.isoA2, prevIsoA2: existing.isoA2 };
  }
  return { id: eventId, isoA2: fields.isoA2 };
}

/**
 * Idempotent batch upsert from the Rust ingestor / migration job.
 * - Upserts articles by externalId (BYO precomputed bge-m3 embeddings).
 * - Recomputes the affected events from their article clusters.
 * Safe to retry: re-running the same batch converges to the same state.
 */
export const ingestBatch = mutation({
  args: {
    ingestKey: v.string(),
    articles: v.array(articleInput),
  },
  returns: v.object({
    inserted: v.number(),
    updated: v.number(),
    events: v.number(),
  }),
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const now = Date.now();
    let inserted = 0;
    let updated = 0;
    const affectedKeys = new Set<string>();

    for (const a of args.articles) {
      if (a.embedding.length !== EMBEDDING_DIMS) {
        throw new Error(`embedding must be ${EMBEDDING_DIMS}-dim, got ${a.embedding.length} for ${a.externalId}`);
      }
      affectedKeys.add(a.eventKey);
      const doc = {
        externalId: a.externalId,
        eventKey: a.eventKey,
        title: a.title,
        summary: a.summary,
        searchText: `${a.title} ${a.summary}`.trim(),
        source: a.source,
        url: a.url,
        isoA2: a.isoA2,
        lon: a.lon,
        lat: a.lat,
        tier: a.tier,
        severity: a.severity,
        category: a.category,
        publishedAt: a.publishedAt,
        entities: a.entities ?? [],
        imageUrl: a.imageUrl,
        recencyBucket: recencyBucket(a.publishedAt, now),
        contentHash: a.contentHash,
        embedding: a.embedding,
      };
      const existing = await ctx.db
        .query("articles")
        .withIndex("by_externalId", (q) => q.eq("externalId", a.externalId))
        .unique();
      if (existing) {
        await ctx.db.patch(existing._id, doc);
        updated++;
      } else {
        await ctx.db.insert("articles", doc);
        inserted++;
      }
    }

    let events = 0;
    const touchedRegions = new Set<string>();
    for (const key of affectedKeys) {
      const res = await recomputeEvent(ctx, key, now);
      if (res) {
        events++;
        touchedRegions.add(res.isoA2);
        if (res.prevIsoA2) touchedRegions.add(res.prevIsoA2);
      }
    }

    // Precompute the per-region rollup once here so events.regionCoverage reads
    // it (O(regions)) instead of every client re-scanning all events per write.
    await recomputeCoverage(ctx, touchedRegions, now);

    return { inserted, updated, events };
  },
});

/** Source-health rollups written by the ingestor after each fetch cycle. */
export const reportSourceHealth = mutation({
  args: {
    ingestKey: v.string(),
    url: v.string(),
    status: v.union(v.literal("ok"), v.literal("warn"), v.literal("err")),
    error: v.optional(v.string()),
    itemCount: v.number(),
  },
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const now = Date.now();
    const src = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_url", (q) => q.eq("url", args.url))
      .unique();
    if (!src) return { ok: false };
    await ctx.db.patch(src._id, {
      lastFetchedAt: now,
      lastStatus: args.status,
      lastError: args.status === "err" ? args.error : undefined,
      consecutiveFailures: args.status === "err" ? src.consecutiveFailures + 1 : 0,
      fetchCount: src.fetchCount + 1,
      itemCount: src.itemCount + args.itemCount,
    });
    return { ok: true };
  },
});

/** Rust ingestor polls this to know whether an on-demand refresh was requested. */
export const consumeRefreshSignal = mutation({
  args: { ingestKey: v.string() },
  returns: v.boolean(),
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const sig = await ctx.db
      .query("controlSignals")
      .withIndex("by_key", (q) => q.eq("key", "refreshRequested"))
      .unique();
    if (sig && sig.value) {
      await ctx.db.patch(sig._id, { value: false, consumedAt: Date.now() });
      return true;
    }
    return false;
  },
});

/** Active, enabled sources for the Rust ingestor's fetch loop. */
export const listSources = query({
  args: { ingestKey: v.string() },
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const rows = await ctx.db
      .query("sourceCatalog")
      .withIndex("by_enabled", (q) => q.eq("enabled", true))
      .collect();
    return rows.map((s) => ({
      id: String(s._id),
      name: s.name,
      url: s.url,
      kind: s.kind,
      region: s.region ?? null,
      category: s.category ?? null,
    }));
  },
});

// Per-transaction delete budget. Each stale article carries a 1024-dim embedding
// (~22 KB), so we cap reads/writes per run and self-reschedule to drain the rest.
const PRUNE_BATCH = 100;

/**
 * Drain articles + their events older than `olderThanDays`, one bounded batch
 * per transaction, rescheduling itself until the backlog is clear.
 *
 * A fixed per-run cap can't bound growth on its own: inflow is thousands of
 * articles/day, so a single 500-row daily pass falls permanently behind. The
 * self-reschedule lets one cron tick reclaim an arbitrarily large backlog while
 * keeping each transaction within Convex's read/write limits.
 */
export const pruneOld = internalMutation({
  args: { olderThanDays: v.number(), batch: v.optional(v.number()) },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - args.olderThanDays * 24 * 3_600_000;
    const batch = args.batch ?? PRUNE_BATCH;
    const staleArticles = await ctx.db
      .query("articles")
      .withIndex("by_publishedAt", (q) => q.lt("publishedAt", cutoff))
      .take(batch);
    for (const a of staleArticles) await ctx.db.delete(a._id);
    const staleEvents = await ctx.db
      .query("events")
      .withIndex("by_publishedAt", (q) => q.lt("publishedAt", cutoff))
      .take(batch);
    for (const e of staleEvents) await ctx.db.delete(e._id);
    // A full batch in either table means more rows remain past the cutoff.
    if (staleArticles.length === batch || staleEvents.length === batch) {
      await ctx.scheduler.runAfter(0, internal.ingest.pruneOld, {
        olderThanDays: args.olderThanDays,
        batch,
      });
    }
    return { articles: staleArticles.length, events: staleEvents.length };
  },
});

/** Migration: stage Stripe billing by email; applied to the user on first login. */
export const stagePendingBilling = mutation({
  args: {
    ingestKey: v.string(),
    email: v.string(),
    stripeCustomerId: v.string(),
    subscriptionStatus: v.string(),
  },
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    const email = args.email.toLowerCase().trim();
    const existing = await ctx.db
      .query("pendingBilling")
      .withIndex("by_email", (q) => q.eq("email", email))
      .unique();
    const fields = {
      email,
      stripeCustomerId: args.stripeCustomerId,
      subscriptionStatus: args.subscriptionStatus,
      createdAt: Date.now(),
    };
    if (existing) {
      await ctx.db.patch(existing._id, fields);
      return existing._id;
    }
    // If the user already exists (re-run), apply directly too.
    const user = await ctx.db
      .query("users")
      .withIndex("email", (q) => q.eq("email", email))
      .unique();
    if (user) {
      await ctx.db.patch(user._id, {
        stripeCustomerId: args.stripeCustomerId,
        subscriptionStatus: args.subscriptionStatus,
      });
    }
    return await ctx.db.insert("pendingBilling", fields);
  },
});

// Default catalog of public, SSRF-safe news feeds — bootstraps LIVE worldwide ingestion.
// Every RSS feed below was fetched and confirmed to return live XML with items at seed time.
export const DEFAULT_SOURCES: {
  name: string;
  url: string;
  kind: "rss" | "gdelt" | "html" | "bluesky";
  category?: string;
  region?: string;
}[] = [
  // ── Global wires (kept from original bootstrap) ──
  { name: "BBC World", url: "http://feeds.bbci.co.uk/news/world/rss.xml", kind: "rss", region: "GLOBAL" },
  { name: "Al Jazeera", url: "https://www.aljazeera.com/xml/rss/all.xml", kind: "rss", region: "GLOBAL" },
  { name: "The Guardian World", url: "https://www.theguardian.com/world/rss", kind: "rss", region: "GLOBAL" },
  { name: "NPR World", url: "https://feeds.npr.org/1004/rss.xml", kind: "rss", region: "GLOBAL" },
  { name: "UN News", url: "https://news.un.org/feed/subscribe/en/news/all/rss.xml", kind: "rss", region: "GLOBAL" },
  { name: "ReliefWeb Updates", url: "https://reliefweb.int/updates/rss.xml", kind: "rss", region: "GLOBAL" },
  // ── Africa ──
  { name: "AllAfrica Headlines", url: "https://allafrica.com/tools/headlines/rdf/latest/headlines.rdf", kind: "rss", region: "AFRICA" },
  { name: "The Guardian — Africa", url: "https://www.theguardian.com/world/africa/rss", kind: "rss", region: "AFRICA" },
  { name: "The Africa Report", url: "https://www.theafricareport.com/feed/", kind: "rss", region: "AFRICA" },
  { name: "Premium Times (Nigeria)", url: "https://www.premiumtimesng.com/feed", kind: "rss", region: "NG" },
  { name: "Mail & Guardian (South Africa)", url: "https://mg.co.za/feed/", kind: "rss", region: "ZA" },
  { name: "News24 (South Africa)", url: "https://feeds.24.com/articles/news24/TopStories/rss", kind: "rss", region: "ZA" },
  { name: "The Standard (Kenya)", url: "https://www.standardmedia.co.ke/rss/headlines.php", kind: "rss", region: "KE" },
  { name: "Nation Africa (Kenya)", url: "https://nation.africa/kenya/rss.xml", kind: "rss", region: "KE" },
  { name: "Egypt Independent", url: "https://www.egyptindependent.com/feed/", kind: "rss", region: "EG" },
  // ── Under-covered Africa (country-specific; region = ISO2 for source-region fallback) ──
  { name: "Mauritania — Sahara Media", url: "https://www.saharamedias.net/feed/", kind: "rss", region: "MR" },
  { name: "Libya — Libya Herald", url: "https://libyaherald.com/feed/", kind: "rss", region: "LY" },
  { name: "Cameroon — Journal du Cameroun", url: "https://www.journalducameroun.com/feed/", kind: "rss", region: "CM" },
  { name: "Central African Republic — Radio Ndeke Luka", url: "https://www.radiondekeluka.org/feed/", kind: "rss", region: "CF" },
  { name: "Republic of Congo — Journal de Brazza", url: "https://www.journaldebrazza.com/feed/", kind: "rss", region: "CG" },
  { name: "Gabon — GabonReview", url: "https://www.gabonreview.com/feed/", kind: "rss", region: "GA" },
  { name: "Zambia — Lusaka Times", url: "https://www.lusakatimes.com/feed/", kind: "rss", region: "ZM" },
  { name: "Zimbabwe — The Herald", url: "https://www.herald.co.zw/feed/", kind: "rss", region: "ZW" },
  { name: "Mozambique — Club of Mozambique", url: "https://clubofmozambique.com/feed/", kind: "rss", region: "MZ" },
  { name: "Madagascar — Madagascar Tribune", url: "https://www.madagascar-tribune.com/spip.php?page=backend", kind: "rss", region: "MG" },
  { name: "Namibia — The Namibian", url: "https://www.namibian.com.na/feed/", kind: "rss", region: "NA" },
  { name: "Mali — Bamada.net", url: "https://bamada.net/feed", kind: "rss", region: "ML" },
  { name: "Niger — Tamtam Info", url: "https://www.tamtaminfo.com/feed/", kind: "rss", region: "NE" },
  { name: "Chad — Tchadinfos", url: "https://www.tchadinfos.com/feed/", kind: "rss", region: "TD" },
  { name: "Burkina Faso — leFaso.net", url: "https://lefaso.net/spip.php?page=backend", kind: "rss", region: "BF" },
  { name: "Senegal — PressAfrik", url: "https://www.pressafrik.com/xml/syndication.rss", kind: "rss", region: "SN" },
  { name: "Guinea — Guinéenews", url: "https://guineenews.org/feed/", kind: "rss", region: "GN" },
  { name: "Uganda — The Observer", url: "https://observer.ug/feed", kind: "rss", region: "UG" },
  { name: "Rwanda — KT Press", url: "https://www.ktpress.rw/feed/", kind: "rss", region: "RW" },
  { name: "Tanzania — Daily News", url: "https://dailynews.co.tz/feed/", kind: "rss", region: "TZ" },
  { name: "Somalia — Goobjoog News", url: "https://goobjoog.com/english/feed/", kind: "rss", region: "SO" },
  // ── Middle East & North Africa ──
  { name: "The Times of Israel", url: "https://www.timesofisrael.com/feed/", kind: "rss", region: "IL" },
  { name: "Al-Monitor", url: "https://www.al-monitor.com/rss", kind: "rss", region: "MENA" },
  { name: "The New Arab", url: "https://www.newarab.com/rss", kind: "rss", region: "MENA" },
  { name: "Arab News (Saudi Arabia)", url: "https://www.arabnews.com/rss.xml", kind: "rss", region: "SA" },
  { name: "Daily Sabah (Turkey)", url: "https://www.dailysabah.com/rssFeed/home", kind: "rss", region: "TR" },
  { name: "Anadolu Agency (Turkey)", url: "https://www.aa.com.tr/en/rss/default?cat=live", kind: "rss", region: "TR" },
  // ── South Asia ──
  { name: "The Hindu (India)", url: "https://www.thehindu.com/news/national/feeder/default.rss", kind: "rss", region: "IN" },
  { name: "Times of India", url: "https://timesofindia.indiatimes.com/rssfeedstopstories.cms", kind: "rss", region: "IN" },
  { name: "Dawn (Pakistan)", url: "https://www.dawn.com/feeds/home", kind: "rss", region: "PK" },
  { name: "Daily Pakistan", url: "https://en.dailypakistan.com.pk/feed", kind: "rss", region: "PK" },
  { name: "The Daily Star (Bangladesh)", url: "https://www.thedailystar.net/rss.xml", kind: "rss", region: "BD" },
  { name: "Dhaka Tribune (Bangladesh)", url: "https://www.dhakatribune.com/feed/", kind: "rss", region: "BD" },
  { name: "The Kathmandu Post (Nepal)", url: "https://kathmandupost.com/rss", kind: "rss", region: "NP" },
  { name: "Sri Lanka — Ada Derana", url: "https://www.adaderana.lk/rss.php", kind: "rss", region: "LK" },
  // ── East Asia ──
  { name: "South China Morning Post (Hong Kong)", url: "https://www.scmp.com/rss/91/feed", kind: "rss", region: "HK" },
  { name: "Yonhap News (South Korea)", url: "https://en.yna.co.kr/RSS/news.xml", kind: "rss", region: "KR" },
  { name: "The Japan Times", url: "https://www.japantimes.co.jp/feed/", kind: "rss", region: "JP" },
  // ── Southeast Asia ──
  { name: "Channel News Asia (Singapore)", url: "https://www.channelnewsasia.com/api/v1/rss-outbound-feed?_format=xml", kind: "rss", region: "SG" },
  { name: "The Straits Times (Singapore)", url: "https://www.straitstimes.com/news/world/rss.xml", kind: "rss", region: "SG" },
  { name: "Rappler (Philippines)", url: "https://www.rappler.com/feed/", kind: "rss", region: "PH" },
  { name: "Philstar (Philippines)", url: "https://www.philstar.com/rss/headlines", kind: "rss", region: "PH" },
  { name: "Antara News (Indonesia)", url: "https://en.antaranews.com/rss/news.xml", kind: "rss", region: "ID" },
  { name: "VnExpress (Vietnam)", url: "https://e.vnexpress.net/rss/news.rss", kind: "rss", region: "VN" },
  { name: "Myanmar — BNI / Myanmar Peace Monitor", url: "https://www.bnionline.net/en/rss.xml", kind: "rss", region: "MM" },
  { name: "Cambodia — Khmer Times", url: "https://www.khmertimeskh.com/feed/", kind: "rss", region: "KH" },
  // ── Oceania ──
  { name: "ABC News (Australia)", url: "https://www.abc.net.au/news/feed/51120/rss.xml", kind: "rss", region: "AU" },
  { name: "The Sydney Morning Herald (Australia)", url: "https://www.smh.com.au/rss/feed.xml", kind: "rss", region: "AU" },
  { name: "RNZ (New Zealand)", url: "https://www.rnz.co.nz/rss/national.xml", kind: "rss", region: "NZ" },
  // ── Latin America ──
  { name: "MercoPress (South America)", url: "https://en.mercopress.com/rss/", kind: "rss", region: "LATAM" },
  { name: "Buenos Aires Times (Argentina)", url: "https://www.batimes.com.ar/feed", kind: "rss", region: "AR" },
  { name: "Buenos Aires Herald (Argentina)", url: "https://buenosairesherald.com/feed", kind: "rss", region: "AR" },
  { name: "The Rio Times (Brazil)", url: "https://www.riotimesonline.com/feed/", kind: "rss", region: "BR" },
  { name: "Mexico News Daily", url: "https://mexiconewsdaily.com/feed/", kind: "rss", region: "MX" },
  { name: "Colombia Reports", url: "https://colombiareports.com/feed/", kind: "rss", region: "CO" },
  { name: "Bolivia — El Deber", url: "https://eldeber.com.bo/rss/portada.xml", kind: "rss", region: "BO" },
  { name: "Paraguay — ABC Color", url: "https://www.abc.com.py/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PY" },
  { name: "Venezuela — Efecto Cocuyo", url: "https://efectococuyo.com/feed/", kind: "rss", region: "VE" },
  { name: "Guatemala — Prensa Libre", url: "https://www.prensalibre.com/feed/", kind: "rss", region: "GT" },
  // ── Caribbean ──
  { name: "Jamaica Gleaner", url: "https://jamaica-gleaner.com/feed/rss.xml", kind: "rss", region: "JM" },
  { name: "Jamaica Observer", url: "https://www.jamaicaobserver.com/feed/", kind: "rss", region: "JM" },
  // ── Western Europe ──
  { name: "Deutsche Welle (Germany)", url: "https://rss.dw.com/rdf/rss-en-all", kind: "rss", region: "DE" },
  { name: "France 24 (English)", url: "https://www.france24.com/en/rss", kind: "rss", region: "FR" },
  { name: "Euronews", url: "https://www.euronews.com/rss", kind: "rss", region: "EU" },
  { name: "The Local (Europe)", url: "https://www.thelocal.com/feeds/rss.php", kind: "rss", region: "EU" },
  // ── Eastern Europe & Eurasia ──
  { name: "Notes from Poland", url: "https://notesfrompoland.com/feed/", kind: "rss", region: "PL" },
  { name: "Ukrainska Pravda (English)", url: "https://www.pravda.com.ua/eng/rss/", kind: "rss", region: "UA" },
  { name: "The Moscow Times", url: "https://www.themoscowtimes.com/rss/news", kind: "rss", region: "RU" },
  { name: "Balkan Insight", url: "https://balkaninsight.com/feed/", kind: "rss", region: "BALKANS" },
  // ── Central Asia & Caucasus ──
  { name: "The Astana Times (Kazakhstan)", url: "https://astanatimes.com/feed/", kind: "rss", region: "KZ" },
  { name: "OC Media (Caucasus)", url: "https://oc-media.org/feed/", kind: "rss", region: "CAUCASUS" },
  { name: "Uzbekistan — Gazeta.uz", url: "https://www.gazeta.uz/en/rss/", kind: "rss", region: "UZ" },
  { name: "Georgia — Civil.ge", url: "https://civil.ge/feed", kind: "rss", region: "GE" },
  { name: "Armenia — Hetq", url: "https://hetq.am/en/rss", kind: "rss", region: "AM" },
  { name: "Azerbaijan — Trend News Agency", url: "https://en.trend.az/feeds/index.rss", kind: "rss", region: "AZ" },
  // -- AMERICAS (global-coverage expansion, live-validated 2026-06-09) --
  { name: "Barbados — Barbados Today", url: "https://barbadostoday.bb/feed/", kind: "rss", region: "BB" },
  { name: "Barbados — Nation News", url: "https://www.nationnews.com/feed/", kind: "rss", region: "BB" },
  { name: "Brazil — Folha de S.Paulo", url: "https://feeds.folha.uol.com.br/emcimadahora/rss091.xml", kind: "rss", region: "BR" },
  { name: "Brazil — G1 (Globo)", url: "https://g1.globo.com/rss/g1/", kind: "rss", region: "BR" },
  { name: "Bahamas — Bahamas Press", url: "https://bahamaspress.com/feed/", kind: "rss", region: "BS" },
  { name: "Bahamas — Our News (Bahamas)", url: "https://ournews.bs/feed/", kind: "rss", region: "BS" },
  { name: "Bahamas — ZNS Bahamas", url: "https://www.znsbahamas.com/feed/", kind: "rss", region: "BS" },
  { name: "Belize — Amandala", url: "https://amandala.com.bz/news/feed/", kind: "rss", region: "BZ" },
  { name: "Belize — Breaking Belize News", url: "https://www.breakingbelizenews.com/feed/", kind: "rss", region: "BZ" },
  { name: "Canada — CBC News (Canada)", url: "https://www.cbc.ca/webfeed/rss/rss-canada", kind: "rss", region: "CA" },
  { name: "Canada — Global News", url: "https://globalnews.ca/feed/", kind: "rss", region: "CA" },
  { name: "Canada — National Post", url: "https://nationalpost.com/feed/", kind: "rss", region: "CA" },
  { name: "Chile — La Tercera", url: "https://www.latercera.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "CL" },
  { name: "Chile — The Clinic", url: "https://www.theclinic.cl/feed/", kind: "rss", region: "CL" },
  { name: "Colombia — El Tiempo", url: "https://www.eltiempo.com/rss/colombia.xml", kind: "rss", region: "CO" },
  { name: "Colombia — Semana", url: "https://www.semana.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "CO" },
  { name: "Costa Rica — Delfino.cr", url: "https://delfino.cr/feed", kind: "rss", region: "CR" },
  { name: "Costa Rica — La Nación", url: "https://www.nacion.com/rss/", kind: "rss", region: "CR" },
  { name: "Cuba — CiberCuba (Noticias)", url: "https://www.cibercuba.com/noticias/cibercuba/rss.xml", kind: "rss", region: "CU" },
  { name: "Cuba — OnCuba News", url: "https://oncubanews.com/feed/", kind: "rss", region: "CU" },
  { name: "Dominican Republic — Diario Libre", url: "https://www.diariolibre.com/rss/portada.xml", kind: "rss", region: "DO" },
  { name: "Dominican Republic — El Nuevo Diario", url: "https://elnuevodiario.com.do/feed/", kind: "rss", region: "DO" },
  { name: "Ecuador — Diario Expreso", url: "https://www.expreso.ec/rss.xml", kind: "rss", region: "EC" },
  { name: "Ecuador — El Universo", url: "https://www.eluniverso.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "EC" },
  { name: "Grenada — Barbados Today (Grenada section)", url: "https://barbadostoday.bb/category/grenada/feed/", kind: "rss", region: "GD" },
  { name: "Grenada — NOW Grenada", url: "https://www.nowgrenada.com/feed/", kind: "rss", region: "GD" },
  { name: "Guatemala — La Hora", url: "https://lahora.gt/feed/", kind: "rss", region: "GT" },
  { name: "Guyana — Guyana Chronicle", url: "https://guyanachronicle.com/feed/", kind: "rss", region: "GY" },
  { name: "Guyana — Kaieteur News", url: "https://www.kaieteurnewsonline.com/feed/", kind: "rss", region: "GY" },
  { name: "Guyana — News Room", url: "https://newsroom.gy/feed/", kind: "rss", region: "GY" },
  { name: "Honduras — Hondudiario", url: "https://hondudiario.com/feed/", kind: "rss", region: "HN" },
  { name: "Honduras — Proceso Digital", url: "https://proceso.hn/feed/", kind: "rss", region: "HN" },
  { name: "Haiti — Le Nouvelliste", url: "https://lenouvelliste.com/feed", kind: "rss", region: "HT" },
  { name: "Haiti — Rezo Nòdwès", url: "https://rezonodwes.com/feed/", kind: "rss", region: "HT" },
  { name: "Haiti — The Haitian Times", url: "https://haitiantimes.com/feed/", kind: "rss", region: "HT" },
  { name: "St Lucia — St Lucia News Online", url: "https://stlucianewsonline.com/feed/", kind: "rss", region: "LC" },
  { name: "St Lucia — St. Lucia Times", url: "https://stluciatimes.com/feed/", kind: "rss", region: "LC" },
  { name: "St Lucia — The Voice (St. Lucia)", url: "https://thevoiceslu.com/feed/", kind: "rss", region: "LC" },
  { name: "Mexico — Expansión", url: "https://expansion.mx/rss", kind: "rss", region: "MX" },
  { name: "Mexico — La Jornada", url: "https://www.jornada.com.mx/rss/edicion.xml", kind: "rss", region: "MX" },
  { name: "Nicaragua — Confidencial", url: "https://confidencial.digital/feed/", kind: "rss", region: "NI" },
  { name: "Nicaragua — Despacho 505", url: "https://www.despacho505.com/feed/", kind: "rss", region: "NI" },
  { name: "Panama — Google News (Panamá edition)", url: "https://news.google.com/rss?hl=es-419&gl=PA&ceid=PA:es-419", kind: "rss", region: "PA" },
  { name: "Panama — La Prensa (Panamá)", url: "https://www.prensa.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PA" },
  { name: "Peru — El Comercio", url: "https://elcomercio.pe/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PE" },
  { name: "Peru — Gestión", url: "https://gestion.pe/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PE" },
  { name: "Peru — RPP Noticias", url: "https://rpp.pe/feed", kind: "rss", region: "PE" },
  { name: "Puerto Rico — El Nuevo Día", url: "https://www.elnuevodia.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PR" },
  { name: "Puerto Rico — NotiCel", url: "https://www.noticel.com/feed/", kind: "rss", region: "PR" },
  { name: "Puerto Rico — Primera Hora", url: "https://www.primerahora.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "PR" },
  { name: "Suriname — Dagblad Suriname", url: "https://www.dbsuriname.com/feed/", kind: "rss", region: "SR" },
  { name: "Suriname — De Ware Tijd", url: "https://dwtonline.com/feed/", kind: "rss", region: "SR" },
  { name: "Suriname — Starnieuws", url: "https://www.starnieuws.com/rss/starnieuws.rss", kind: "rss", region: "SR" },
  { name: "Suriname — United News", url: "https://unitednews.sr/feed/", kind: "rss", region: "SR" },
  { name: "El Salvador — Diario Co Latino", url: "https://www.diariocolatino.com/feed/", kind: "rss", region: "SV" },
  { name: "El Salvador — Revista Factum", url: "https://revistafactum.com/feed/", kind: "rss", region: "SV" },
  { name: "Trinidad & Tobago — CNC3", url: "https://www.cnc3.co.tt/feed/", kind: "rss", region: "TT" },
  { name: "Trinidad & Tobago — Newsday", url: "https://newsday.co.tt/feed/", kind: "rss", region: "TT" },
  { name: "Trinidad & Tobago — Trinidad Express", url: "https://trinidadexpress.com/search/?f=rss&t=article&c=news&l=50&s=start_time&sd=desc", kind: "rss", region: "TT" },
  { name: "United States — ABC News (US Headlines)", url: "https://abcnews.go.com/abcnews/usheadlines", kind: "rss", region: "US" },
  { name: "United States — Chicago Sun-Times", url: "https://chicago.suntimes.com/rss/index.xml", kind: "rss", region: "US" },
  { name: "United States — Los Angeles Times (California)", url: "https://www.latimes.com/local/rss2.0.xml", kind: "rss", region: "US" },
  { name: "United States — NPR News (Top Stories)", url: "https://feeds.npr.org/1001/rss.xml", kind: "rss", region: "US" },
  { name: "United States — The Guardian (US news)", url: "https://www.theguardian.com/us-news/rss", kind: "rss", region: "US" },
  { name: "United States — Washington Post (National)", url: "https://feeds.washingtonpost.com/rss/national", kind: "rss", region: "US" },
  { name: "Uruguay — El País", url: "https://www.elpais.com.uy/rss/", kind: "rss", region: "UY" },
  { name: "Uruguay — la diaria", url: "https://ladiaria.com.uy/feeds/articulos/", kind: "rss", region: "UY" },
  { name: "Uruguay — Montevideo Portal", url: "https://www.montevideo.com.uy/anxml.aspx?59", kind: "rss", region: "UY" },
  { name: "Uruguay — Teledoce", url: "https://www.teledoce.com/feed/", kind: "rss", region: "UY" },
  { name: "Venezuela — El Nacional", url: "https://www.elnacional.com/feed/", kind: "rss", region: "VE" },
  { name: "Venezuela — El Pitazo", url: "https://elpitazo.net/feed/", kind: "rss", region: "VE" },
  { name: "Venezuela — TalCual", url: "https://talcualdigital.com/feed/", kind: "rss", region: "VE" },
  // -- EUROPE (global-coverage expansion, live-validated 2026-06-09) --
  { name: "Albania — Gazeta Panorama", url: "https://www.panorama.com.al/feed/", kind: "rss", region: "AL" },
  { name: "Albania — Reporter.al (BIRN)", url: "https://www.reporter.al/feed/", kind: "rss", region: "AL" },
  { name: "Albania — Tirana Times", url: "https://www.tiranatimes.com/feed/", kind: "rss", region: "AL" },
  { name: "Austria — Der Standard", url: "https://www.derstandard.at/rss", kind: "rss", region: "AT" },
  { name: "Austria — ORF News", url: "https://rss.orf.at/news.xml", kind: "rss", region: "AT" },
  { name: "Bosnia & Herzegovina — Dnevni avaz", url: "https://www.avaz.ba/rss", kind: "rss", region: "BA" },
  { name: "Bosnia & Herzegovina — Klix.ba", url: "https://www.klix.ba/rss", kind: "rss", region: "BA" },
  { name: "Bosnia & Herzegovina — N1 Info BiH", url: "https://n1info.ba/feed/", kind: "rss", region: "BA" },
  { name: "Bosnia & Herzegovina — Sarajevo Times", url: "https://sarajevotimes.com/feed/", kind: "rss", region: "BA" },
  { name: "Belgium — La Libre", url: "https://www.lalibre.be/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "BE" },
  { name: "Belgium — VRT NWS", url: "https://www.vrt.be/vrtnws/nl.rss.articles.xml", kind: "rss", region: "BE" },
  { name: "Bulgaria — Dnevnik", url: "https://www.dnevnik.bg/rss/", kind: "rss", region: "BG" },
  { name: "Bulgaria — Novinite / Sofia News Agency (English)", url: "https://www.novinite.com/services/news_rdf.php", kind: "rss", region: "BG" },
  { name: "Belarus — BelTA (state news agency, Russian)", url: "https://www.belta.by/rss", kind: "rss", region: "BY" },
  { name: "Belarus — Minsk News (minsknews.by)", url: "https://minsknews.by/feed/", kind: "rss", region: "BY" },
  { name: "Switzerland — Neue Zürcher Zeitung (NZZ)", url: "https://www.nzz.ch/recent.rss", kind: "rss", region: "CH" },
  { name: "Switzerland — SRF News", url: "https://www.srf.ch/news/bnf/rss/1646", kind: "rss", region: "CH" },
  { name: "Czechia — ČT24 (Czech TV)", url: "https://ct24.ceskatelevize.cz/rss/hlavni-zpravy", kind: "rss", region: "CZ" },
  { name: "Czechia — iROZHLAS (Czech Radio)", url: "https://www.irozhlas.cz/rss/irozhlas", kind: "rss", region: "CZ" },
  { name: "Czechia — Novinky.cz", url: "https://www.novinky.cz/rss", kind: "rss", region: "CZ" },
  { name: "Denmark — DR Nyheder", url: "https://www.dr.dk/nyheder/service/feeds/allenyheder", kind: "rss", region: "DK" },
  { name: "Denmark — The Local Denmark", url: "https://www.thelocal.dk/feeds/rss.php", kind: "rss", region: "DK" },
  { name: "Estonia — ERR News (English)", url: "https://news.err.ee/rss", kind: "rss", region: "EE" },
  { name: "Estonia — ERR Uudised (Estonian)", url: "https://www.err.ee/rss", kind: "rss", region: "EE" },
  { name: "Estonia — Postimees (English)", url: "https://news.postimees.ee/rss", kind: "rss", region: "EE" },
  { name: "Spain — El Mundo", url: "https://e00-elmundo.uecdn.es/elmundo/rss/portada.xml", kind: "rss", region: "ES" },
  { name: "Spain — El País", url: "https://feeds.elpais.com/mrss-s/pages/ep/site/elpais.com/portada", kind: "rss", region: "ES" },
  { name: "Spain — elDiario.es", url: "https://www.eldiario.es/rss/", kind: "rss", region: "ES" },
  { name: "Finland — Yle News", url: "https://feeds.yle.fi/uutiset/v1/recent.rss?publisherIds=YLE_NEWS", kind: "rss", region: "FI" },
  { name: "Finland — Yle Uutiset", url: "https://feeds.yle.fi/uutiset/v1/majorHeadlines/YLE_UUTISET.rss", kind: "rss", region: "FI" },
  { name: "United Kingdom — BBC News", url: "https://feeds.bbci.co.uk/news/rss.xml", kind: "rss", region: "GB" },
  { name: "United Kingdom — The Guardian (UK)", url: "https://www.theguardian.com/uk/rss", kind: "rss", region: "GB" },
  { name: "Greece — Naftemporiki", url: "https://www.naftemporiki.gr/feed/", kind: "rss", region: "GR" },
  { name: "Greece — To Vima (International Edition)", url: "https://www.tovima.com/feed/", kind: "rss", region: "GR" },
  { name: "Croatia — Croatia Week", url: "https://www.croatiaweek.com/feed/", kind: "rss", region: "HR" },
  { name: "Croatia — Index.hr (Vijesti)", url: "https://www.index.hr/rss/vijesti", kind: "rss", region: "HR" },
  { name: "Croatia — Total Croatia News", url: "https://total-croatia-news.com/feed/", kind: "rss", region: "HR" },
  { name: "Croatia — Vecernji list (Latest)", url: "https://www.vecernji.hr/feeds/latest", kind: "rss", region: "HR" },
  { name: "Hungary — Daily News Hungary (English)", url: "https://dailynewshungary.com/feed/", kind: "rss", region: "HU" },
  { name: "Hungary — HVG", url: "https://hvg.hu/rss", kind: "rss", region: "HU" },
  { name: "Hungary — Telex (latest)", url: "https://telex.hu/rss", kind: "rss", region: "HU" },
  { name: "Ireland — RTÉ News", url: "https://www.rte.ie/feeds/rss/?index=/news/", kind: "rss", region: "IE" },
  { name: "Ireland — The Irish Times", url: "https://www.irishtimes.com/cmlink/news-1.1319192", kind: "rss", region: "IE" },
  { name: "Iceland — RÚV", url: "https://www.ruv.is/rss/frettir", kind: "rss", region: "IS" },
  { name: "Iceland — The Reykjavík Grapevine", url: "https://grapevine.is/feed/", kind: "rss", region: "IS" },
  { name: "Iceland — Vísir", url: "https://www.visir.is/rss/allt", kind: "rss", region: "IS" },
  { name: "Italy — ANSA (Primo piano)", url: "https://www.ansa.it/sito/ansait_rss.xml", kind: "rss", region: "IT" },
  { name: "Italy — la Repubblica", url: "https://www.repubblica.it/rss/homepage/rss2.0.xml", kind: "rss", region: "IT" },
  { name: "Lithuania — 15min", url: "https://www.15min.lt/rss/naujienos", kind: "rss", region: "LT" },
  { name: "Lithuania — Delfi (Lietuvoje)", url: "https://feed.delfi.lt/v2/articles/7?format=rss", kind: "rss", region: "LT" },
  { name: "Luxembourg — Luxembourg Times", url: "https://www.luxtimes.lu/rss", kind: "rss", region: "LU" },
  { name: "Luxembourg — Luxemburger Wort", url: "https://www.wort.lu/rss", kind: "rss", region: "LU" },
  { name: "Latvia — LSM (English)", url: "https://eng.lsm.lv/rss/", kind: "rss", region: "LV" },
  { name: "Latvia — LSM (Latvian)", url: "https://www.lsm.lv/rss/", kind: "rss", region: "LV" },
  { name: "Moldova — NewsMaker", url: "https://newsmaker.md/feed", kind: "rss", region: "MD" },
  { name: "Moldova — TV8", url: "https://tv8.md/feed", kind: "rss", region: "MD" },
  { name: "Moldova — Ziarul de Gardă (ZDG)", url: "https://www.zdg.md/feed", kind: "rss", region: "MD" },
  { name: "Montenegro — CdM (Cafe del Montenegro)", url: "https://www.cdm.me/feed/", kind: "rss", region: "ME" },
  { name: "Montenegro — RTCG (public broadcaster)", url: "https://rtcg.me/rss.html", kind: "rss", region: "ME" },
  { name: "Montenegro — Vijesti", url: "https://www.vijesti.me/rss", kind: "rss", region: "ME" },
  { name: "North Macedonia — A1on", url: "https://a1on.mk/feed/", kind: "rss", region: "MK" },
  { name: "North Macedonia — Republika (English)", url: "https://english.republika.mk/feed/", kind: "rss", region: "MK" },
  { name: "North Macedonia — Sloboden Pecat", url: "https://www.slobodenpecat.mk/feed/", kind: "rss", region: "MK" },
  { name: "Netherlands — DutchNews.nl", url: "https://www.dutchnews.nl/feed/", kind: "rss", region: "NL" },
  { name: "Netherlands — NOS Nieuws", url: "https://feeds.nos.nl/nosnieuwsalgemeen", kind: "rss", region: "NL" },
  { name: "Netherlands — NRC", url: "https://www.nrc.nl/rss/", kind: "rss", region: "NL" },
  { name: "Norway — NRK", url: "https://www.nrk.no/toppsaker.rss", kind: "rss", region: "NO" },
  { name: "Norway — The Local Norway", url: "https://www.thelocal.no/feeds/rss.php", kind: "rss", region: "NO" },
  { name: "Poland — TVN24 (latest)", url: "https://tvn24.pl/najnowsze.xml", kind: "rss", region: "PL" },
  { name: "Portugal — Observador", url: "https://observador.pt/feed/", kind: "rss", region: "PT" },
  { name: "Portugal — RTP Notícias", url: "https://www.rtp.pt/noticias/rss", kind: "rss", region: "PT" },
  { name: "Romania — Digi24", url: "https://www.digi24.ro/rss", kind: "rss", region: "RO" },
  { name: "Romania — G4Media", url: "https://www.g4media.ro/feed", kind: "rss", region: "RO" },
  { name: "Romania — HotNews", url: "https://hotnews.ro/feed", kind: "rss", region: "RO" },
  { name: "Serbia — Blic (Today's news)", url: "https://www.blic.rs/rss/danasnje-vesti", kind: "rss", region: "RS" },
  { name: "Serbia — N1 Info Serbia", url: "https://n1info.rs/feed/", kind: "rss", region: "RS" },
  { name: "Serbia — Serbian Monitor (English)", url: "https://www.serbianmonitor.com/en/feed/", kind: "rss", region: "RS" },
  { name: "Sweden — SVT Nyheter", url: "https://www.svt.se/nyheter/rss.xml", kind: "rss", region: "SE" },
  { name: "Sweden — The Local Sweden", url: "https://www.thelocal.se/feeds/rss.php", kind: "rss", region: "SE" },
  { name: "Slovenia — 24ur.com", url: "https://www.24ur.com/rss", kind: "rss", region: "SI" },
  { name: "Slovenia — Delo", url: "https://www.delo.si/rss/", kind: "rss", region: "SI" },
  { name: "Slovenia — RTV Slovenija (MMC, Slovenija)", url: "https://www.rtvslo.si/feeds/01.xml", kind: "rss", region: "SI" },
  { name: "Slovenia — The Slovenia Times", url: "https://sloveniatimes.com/feed/", kind: "rss", region: "SI" },
  { name: "Slovakia — Aktuality.sk", url: "https://www.aktuality.sk/rss/", kind: "rss", region: "SK" },
  { name: "Slovakia — SME.sk", url: "https://www.sme.sk/rss-title", kind: "rss", region: "SK" },
  { name: "Slovakia — The Slovak Spectator (English)", url: "https://spectator.sme.sk/rss", kind: "rss", region: "SK" },
  { name: "Kosovo — Gazeta Express", url: "https://gazetaexpress.com/feed/", kind: "rss", region: "XK" },
  { name: "Kosovo — Koha.net", url: "https://www.koha.net/rss", kind: "rss", region: "XK" },
  { name: "Kosovo — KoSSev", url: "https://kossev.info/feed/", kind: "rss", region: "XK" },
  { name: "Kosovo — Prishtina Insight", url: "https://prishtinainsight.com/feed/", kind: "rss", region: "XK" },
  { name: "Kosovo — Telegrafi", url: "https://telegrafi.com/feed/", kind: "rss", region: "XK" },
  // -- MIDDLE EAST (global-coverage expansion, live-validated 2026-06-09) --
  { name: "UAE — Google News (UAE edition)", url: "https://news.google.com/rss?hl=en&gl=AE&ceid=AE:en", kind: "rss", region: "AE" },
  { name: "UAE — The National", url: "https://www.thenationalnews.com/arc/outboundfeeds/rss/?outputType=xml", kind: "rss", region: "AE" },
  { name: "Bahrain — Google News (Bahrain edition)", url: "https://news.google.com/rss?hl=en&gl=BH&ceid=BH:en", kind: "rss", region: "BH" },
  { name: "Bahrain — Google News (Bahrain topic search)", url: "https://news.google.com/rss/search?q=Bahrain&hl=en&gl=BH&ceid=BH:en", kind: "rss", region: "BH" },
  { name: "Israel — The Jerusalem Post (Front Page)", url: "https://www.jpost.com/rss/rssfeedsfrontpage.aspx", kind: "rss", region: "IL" },
  { name: "Iraq — Iraqi News", url: "https://www.iraqinews.com/feed/", kind: "rss", region: "IQ" },
  { name: "Iraq / Pan-Arab — Asharq Al-Awsat (English)", url: "https://english.aawsat.com/feed", kind: "rss", region: "IQ" },
  { name: "Iran — IranWire (English)", url: "https://iranwire.com/en/feed/", kind: "rss", region: "IR" },
  { name: "Iran — Press TV", url: "https://www.presstv.ir/rss.xml", kind: "rss", region: "IR" },
  { name: "Iran — Tehran Times", url: "https://www.tehrantimes.com/rss", kind: "rss", region: "IR" },
  { name: "Jordan — Jordan News (English)", url: "https://jordannews.jo/rss", kind: "rss", region: "JO" },
  { name: "Jordan — Roya TV (Arabic)", url: "https://www.roya.tv/rss", kind: "rss", region: "JO" },
  { name: "Kuwait — Google News (Kuwait edition)", url: "https://news.google.com/rss?hl=en&gl=KW&ceid=KW:en", kind: "rss", region: "KW" },
  { name: "Kuwait — Google News (Kuwait topic search)", url: "https://news.google.com/rss/search?q=Kuwait&hl=en&gl=KW&ceid=KW:en", kind: "rss", region: "KW" },
  { name: "Lebanon — An-Nahar", url: "https://en.annahar.com/rss", kind: "rss", region: "LB" },
  { name: "Lebanon — This Is Beirut (English)", url: "https://thisisbeirut.com.lb/rss", kind: "rss", region: "LB" },
  { name: "Oman — Google News (Oman edition)", url: "https://news.google.com/rss?hl=en&gl=OM&ceid=OM:en", kind: "rss", region: "OM" },
  { name: "Oman — Times of Oman", url: "https://timesofoman.com/feed", kind: "rss", region: "OM" },
  { name: "Palestine — Al-Quds (Arabic)", url: "https://www.alquds.com/feed/", kind: "rss", region: "PS" },
  { name: "Palestine — Quds News Network (Arabic)", url: "https://www.qudsn.co/rss", kind: "rss", region: "PS" },
  { name: "Qatar — Gulf Times", url: "https://www.gulf-times.com/rss/1/News.xml", kind: "rss", region: "QA" },
  { name: "Saudi Arabia — Google News (Saudi edition)", url: "https://news.google.com/rss?hl=en&gl=SA&ceid=SA:en", kind: "rss", region: "SA" },
  { name: "Syria — Enab Baladi", url: "https://www.enabbaladi.net/feed", kind: "rss", region: "SY" },
  { name: "Syria — SANA (Arabic)", url: "https://sana.sy/?feed=rss2", kind: "rss", region: "SY" },
  { name: "Syria — Syria Direct (English)", url: "https://syriadirect.org/feed/", kind: "rss", region: "SY" },
  { name: "Yemen — Al-Masdar Online", url: "https://www.almasdaronline.com/rss", kind: "rss", region: "YE" },
  { name: "Yemen — Al-Sahwa Net", url: "https://www.alsahwa-yemen.net/rss", kind: "rss", region: "YE" },
  { name: "Yemen — Google News (Yemen, English)", url: "https://news.google.com/rss/search?q=Yemen&hl=en&gl=US&ceid=US:en", kind: "rss", region: "YE" },
  // -- AFRICA (global-coverage expansion, live-validated 2026-06-09) --
  { name: "Angola — AllAfrica: Angola", url: "https://allafrica.com/tools/headlines/rdf/angola/headlines.rdf", kind: "rss", region: "AO" },
  { name: "Burundi — Iwacu", url: "https://www.iwacu-burundi.org/feed/", kind: "rss", region: "BI" },
  { name: "Burundi — SOS Médias Burundi", url: "https://www.sosmediasburundi.org/feed/", kind: "rss", region: "BI" },
  { name: "Benin — Benin Web TV", url: "https://beninwebtv.com/feed/", kind: "rss", region: "BJ" },
  { name: "Benin — La Nouvelle Tribune", url: "https://lanouvelletribune.info/feed/", kind: "rss", region: "BJ" },
  { name: "Benin — Matin Libre", url: "https://matinlibre.com/feed/", kind: "rss", region: "BJ" },
  { name: "Botswana — Mmegi (News)", url: "https://www.mmegi.bw/rssFeed/1", kind: "rss", region: "BW" },
  { name: "DR Congo — Actualite.cd", url: "https://actualite.cd/feed", kind: "rss", region: "CD" },
  { name: "DR Congo — Le Congo au Quotidien", url: "https://www.congoquotidien.com/feed/", kind: "rss", region: "CD" },
  { name: "DR Congo — Scoop RDC", url: "https://scooprdc.net/feed/", kind: "rss", region: "CD" },
  { name: "Cote d'Ivoire — AIP (Agence Ivoirienne de Presse)", url: "https://www.aip.ci/feed/", kind: "rss", region: "CI" },
  { name: "Cote d'Ivoire — Connectionivoirienne", url: "https://connectionivoirienne.net/feed/", kind: "rss", region: "CI" },
  { name: "Cote d'Ivoire — Linfodrome", url: "https://www.linfodrome.com/rss", kind: "rss", region: "CI" },
  { name: "Djibouti — La Nation", url: "https://www.lanation.dj/feed/", kind: "rss", region: "DJ" },
  { name: "Algeria — Algerie360", url: "https://www.algerie360.com/feed/", kind: "rss", region: "DZ" },
  { name: "Algeria — TSA (Tout Sur l'Algérie)", url: "https://www.tsa-algerie.com/feed/", kind: "rss", region: "DZ" },
  { name: "Egypt — Daily News Egypt", url: "https://www.dailynewsegypt.com/feed/", kind: "rss", region: "EG" },
  { name: "Ethiopia — Fana Broadcasting Corporate (English)", url: "https://www.fanabc.com/english/feed/", kind: "rss", region: "ET" },
  { name: "Ghana — 3News", url: "https://3news.com/feed/", kind: "rss", region: "GH" },
  { name: "Ghana — MyJoyOnline", url: "https://www.myjoyonline.com/feed/", kind: "rss", region: "GH" },
  { name: "Gambia — Foroyaa", url: "https://foroyaa.net/feed/", kind: "rss", region: "GM" },
  { name: "Gambia — Kerr Fatou", url: "https://www.kerrfatou.com/feed/", kind: "rss", region: "GM" },
  { name: "Gambia — The Fatu Network", url: "https://thefatunetwork.com/feed/", kind: "rss", region: "GM" },
  { name: "Gambia — The Standard", url: "https://standard.gm/feed/", kind: "rss", region: "GM" },
  { name: "Equatorial Guinea — Ahora EG", url: "https://ahoraeg.com/feed/", kind: "rss", region: "GQ" },
  { name: "Equatorial Guinea — Diario Rombe", url: "https://diariorombe.es/feed/", kind: "rss", region: "GQ" },
  { name: "Guinea-Bissau — AllAfrica (Guinea-Bissau desk)", url: "https://allafrica.com/tools/headlines/rdf/guineabissau/headlines.rdf", kind: "rss", region: "GW" },
  { name: "Guinea-Bissau — Google News (Guiné-Bissau, pt)", url: "https://news.google.com/rss/search?q=Guin%C3%A9-Bissau&hl=pt-PT&gl=GW&ceid=GW:pt", kind: "rss", region: "GW" },
  { name: "Comoros — Comores-Infos", url: "https://www.comores-infos.net/feed/", kind: "rss", region: "KM" },
  { name: "Liberia — FrontPage Africa", url: "https://fpa.news/feed/", kind: "rss", region: "LR" },
  { name: "Liberia — Global News Network Liberia (GNN)", url: "https://gnnliberia.com/feed/", kind: "rss", region: "LR" },
  { name: "Liberia — The Liberian Investigator", url: "https://liberianinvestigator.com/feed/", kind: "rss", region: "LR" },
  { name: "Lesotho — Lesotho Times", url: "https://lestimes.com/?feed=rss2", kind: "rss", region: "LS" },
  { name: "Lesotho — Public Eye", url: "https://publiceyenews.com/feed/", kind: "rss", region: "LS" },
  { name: "Libya — Libya Update", url: "https://libyaupdate.com/feed/", kind: "rss", region: "LY" },
  { name: "Morocco — Hespress (Arabic)", url: "https://www.hespress.com/feed", kind: "rss", region: "MA" },
  { name: "Morocco — Hespress English", url: "https://en.hespress.com/feed", kind: "rss", region: "MA" },
  { name: "Mauritius — Defimedia (Defi Media Group)", url: "https://defimedia.info/rss.xml", kind: "rss", region: "MU" },
  { name: "Mauritius — Le Mauricien", url: "https://www.lemauricien.com/feed/", kind: "rss", region: "MU" },
  { name: "Malawi — Nyasa Times", url: "https://www.nyasatimes.com/feed/", kind: "rss", region: "MW" },
  { name: "Malawi — The Maravi Post", url: "https://www.maravipost.com/feed/", kind: "rss", region: "MW" },
  { name: "Malawi — Times Group (Times MW)", url: "https://times.mw/feed/", kind: "rss", region: "MW" },
  { name: "Seychelles — SBC (Seychelles Broadcasting Corporation)", url: "https://www.sbc.sc/feed/", kind: "rss", region: "SC" },
  { name: "Sudan — Dabanga (Arabic)", url: "https://www.dabangasudan.org/ar/feed", kind: "rss", region: "SD" },
  { name: "Sudan — Dabanga (English)", url: "https://www.dabangasudan.org/en/feed", kind: "rss", region: "SD" },
  { name: "Sudan — Sudan Akhbar", url: "https://www.sudanakhbar.com/feed", kind: "rss", region: "SD" },
  { name: "Sudan — Sudan War Monitor", url: "https://sudanwarmonitor.com/feed", kind: "rss", region: "SD" },
  { name: "Sierra Leone — Cocorioko", url: "https://cocorioko.net/feed/", kind: "rss", region: "SL" },
  { name: "Sierra Leone — Sierraloaded", url: "https://sierraloaded.sl/feed/", kind: "rss", region: "SL" },
  { name: "South Sudan — Radio Tamazuj", url: "https://www.radiotamazuj.org/en/feed", kind: "rss", region: "SS" },
  { name: "South Sudan — Sudans Post", url: "https://www.sudanspost.com/feed/", kind: "rss", region: "SS" },
  { name: "Togo — Icilome", url: "https://icilome.com/feed/", kind: "rss", region: "TG" },
  { name: "Togo — Togo Actualite", url: "https://togoactualite.com/feed/", kind: "rss", region: "TG" },
  { name: "Tunisia — Business News", url: "https://businessnews.com.tn/feed/", kind: "rss", region: "TN" },
  { name: "Tunisia — Kapitalis", url: "https://kapitalis.com/tunisie/feed/", kind: "rss", region: "TN" },
  // -- ASIA (global-coverage expansion, live-validated 2026-06-09) --
  { name: "Afghanistan — Khaama Press", url: "https://www.khaama.com/feed/", kind: "rss", region: "AF" },
  { name: "Afghanistan — Pajhwok Afghan News", url: "https://pajhwok.com/feed/", kind: "rss", region: "AF" },
  { name: "Brunei — The Scoop", url: "https://thescoop.co/feed/", kind: "rss", region: "BN" },
  { name: "Bhutan — BBS (Bhutan Broadcasting Service)", url: "https://www.bbs.bt/feed/", kind: "rss", region: "BT" },
  { name: "Bhutan — Bhutan Times", url: "https://bhutantimes.bt/feed/", kind: "rss", region: "BT" },
  { name: "Bhutan — The Bhutanese", url: "https://thebhutanese.bt/feed/", kind: "rss", region: "BT" },
  { name: "China — Sixth Tone", url: "https://www.sixthtone.com/rss", kind: "rss", region: "CN" },
  { name: "China — South China Morning Post (China)", url: "https://www.scmp.com/rss/4/feed", kind: "rss", region: "CN" },
  { name: "India — LiveMint (news)", url: "https://www.livemint.com/rss/news", kind: "rss", region: "IN" },
  { name: "India — The Indian Express (India section)", url: "https://indianexpress.com/section/india/feed/", kind: "rss", region: "IN" },
  { name: "Kyrgyzstan — 24.kg", url: "https://24.kg/rss/", kind: "rss", region: "KG" },
  { name: "Kyrgyzstan — AKIpress (English)", url: "https://akipress.com/rss/eng_news.rss", kind: "rss", region: "KG" },
  { name: "Laos — Laopost", url: "https://laopost.com/feed/", kind: "rss", region: "LA" },
  { name: "Laos — Laotian Times", url: "https://laotiantimes.com/feed/", kind: "rss", region: "LA" },
  { name: "Mongolia — iKon.mn", url: "https://ikon.mn/rss/", kind: "rss", region: "MN" },
  { name: "Maldives — PSM News (English)", url: "https://www.psmnews.mv/en/feed", kind: "rss", region: "MV" },
  { name: "Maldives — Sun Online (English)", url: "https://en.sun.mv/feed", kind: "rss", region: "MV" },
  { name: "Malaysia — Free Malaysia Today", url: "https://www.freemalaysiatoday.com/feed/", kind: "rss", region: "MY" },
  { name: "Malaysia — Malay Mail (Malaysia)", url: "https://www.malaymail.com/feed/rss/malaysia", kind: "rss", region: "MY" },
  { name: "Malaysia — New Straits Times", url: "https://www.nst.com.my/feed", kind: "rss", region: "MY" },
  { name: "Thailand — Bangkok Post (Most Recent)", url: "https://www.bangkokpost.com/rss/data/most-recent.xml", kind: "rss", region: "TH" },
  { name: "Tajikistan — Asia-Plus (English)", url: "https://asiaplustj.info/en/rss.xml", kind: "rss", region: "TJ" },
  { name: "Tajikistan — Avesta", url: "https://avesta.tj/feed/", kind: "rss", region: "TJ" },
  { name: "Timor-Leste — Government of Timor-Leste (EN)", url: "https://timor-leste.gov.tl/?feed=rss2&lang=en", kind: "rss", region: "TL" },
  { name: "Timor-Leste — Tatoli (English)", url: "https://en.tatoli.tl/feed/", kind: "rss", region: "TL" },
  { name: "Turkmenistan — Arzuw News", url: "https://arzuw.news/feed", kind: "rss", region: "TM" },
  { name: "Turkmenistan — Orient (English)", url: "https://orient.tm/en/feed/", kind: "rss", region: "TM" },
  { name: "Turkmenistan — Turkmen.news", url: "https://turkmen.news/feed/", kind: "rss", region: "TM" },
  { name: "Taiwan — Liberty Times (LTN)", url: "https://news.ltn.com.tw/rss/all.xml", kind: "rss", region: "TW" },
  { name: "Taiwan — Taipei Times", url: "https://www.taipeitimes.com/xml/index.rss", kind: "rss", region: "TW" },
  // -- OCEANIA (global-coverage expansion, live-validated 2026-06-09) --
  { name: "Fiji — FBC News", url: "https://www.fbcnews.com.fj/feed/", kind: "rss", region: "FJ" },
  { name: "Fiji — Islands Business", url: "https://islandsbusiness.com/feed/", kind: "rss", region: "FJ" },
  { name: "Pacific (PG/FJ) — RNZ Pacific", url: "https://www.rnz.co.nz/rss/pacific.xml", kind: "rss", region: "PG" },
  { name: "Papua New Guinea — Inside PNG", url: "https://insidepng.com/feed/", kind: "rss", region: "PG" },
  { name: "Papua New Guinea — Post Courier", url: "https://www.postcourier.com.pg/feed/", kind: "rss", region: "PG" },
  // -- OTHER (global-coverage expansion, live-validated 2026-06-09) --
  { name: "MENA — Middle East Eye", url: "https://www.middleeasteye.net/rss", kind: "rss", region: "MENA" },
  { name: "MENA — Middle East Monitor (MEMO)", url: "https://www.middleeastmonitor.com/feed/", kind: "rss", region: "MENA" },
  // ── Global events firehose ──
  { name: "GDELT — global events", url: "conflict OR protest OR earthquake OR cyberattack OR famine OR coup OR airstrike OR election", kind: "gdelt", region: "GLOBAL" },
  // ── Social signal: Mastodon hashtag RSS (verified live) ──
  { name: "Mastodon · #breakingnews", url: "https://mastodon.social/tags/breakingnews.rss", kind: "rss", category: "social", region: "global" },
  { name: "Mastodon · #earthquake", url: "https://mastodon.social/tags/earthquake.rss", kind: "rss", category: "social", region: "global" },
  { name: "Mastodon · #wildfire", url: "https://mastodon.social/tags/wildfire.rss", kind: "rss", category: "social", region: "global" },
  { name: "Mastodon · #flood", url: "https://mastodon.social/tags/flood.rss", kind: "rss", category: "social", region: "global" },
  { name: "Mastodon · #conflict", url: "https://mastodon.social/tags/conflict.rss", kind: "rss", category: "social", region: "global" },
  // ── Social signal: Bluesky account RSS (verified live) ──
  { name: "Bluesky · @bellingcat.com", url: "https://bsky.app/profile/bellingcat.com/rss", kind: "rss", category: "social", region: "global" },
  { name: "Bluesky · @reuters.com", url: "https://bsky.app/profile/reuters.com/rss", kind: "rss", category: "social", region: "global" },
];

// Sources pulled from DEFAULT_SOURCES are also removed from the live catalog on
// the next seed. Bluesky's free keyword-search API now returns 403 (no free
// read access) — the bluesky KIND + fetcher stay for a future authed key.
const RETIRED_SOURCE_URLS = [
  "earthquake OR explosion OR airstrike OR shooting OR wildfire OR flood OR evacuation OR coup",
  "protest OR clashes OR ceasefire OR offensive OR drone strike OR shelling",
];

/** Idempotently seed the default source catalog (bootstrap; ingestKey-guarded). */
export const seedSources = mutation({
  args: { ingestKey: v.string() },
  returns: v.object({ added: v.number(), existing: v.number() }),
  handler: async (ctx, args) => {
    assertIngestKey(args.ingestKey);
    for (const url of RETIRED_SOURCE_URLS) {
      const dead = await ctx.db.query("sourceCatalog").withIndex("by_url", (q) => q.eq("url", url)).unique();
      if (dead) await ctx.db.delete(dead._id);
    }
    const now = Date.now();
    let added = 0;
    let existing = 0;
    for (const s of DEFAULT_SOURCES) {
      const found = await ctx.db
        .query("sourceCatalog")
        .withIndex("by_url", (q) => q.eq("url", s.url))
        .unique();
      if (found) {
        existing++;
        continue;
      }
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
    return { added, existing };
  },
});