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

async function recomputeEvent(ctx: MutationCtx, eventKey: string, now: number): Promise<Id<"events"> | null> {
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
  return eventId;
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
    for (const key of affectedKeys) {
      const id = await recomputeEvent(ctx, key, now);
      if (id) events++;
    }

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
const DEFAULT_SOURCES: {
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
  { name: "Angola — Jornal de Angola", url: "https://www.jornaldeangola.ao/", kind: "html", region: "AO" },
  { name: "Zambia — Lusaka Times", url: "https://www.lusakatimes.com/feed/", kind: "rss", region: "ZM" },
  { name: "Zimbabwe — The Herald", url: "https://www.herald.co.zw/feed/", kind: "rss", region: "ZW" },
  { name: "Mozambique — Club of Mozambique", url: "https://clubofmozambique.com/feed/", kind: "rss", region: "MZ" },
  { name: "Madagascar — Madagascar Tribune", url: "https://www.madagascar-tribune.com/spip.php?page=backend", kind: "rss", region: "MG" },
  { name: "Botswana — Sunday Standard", url: "https://www.sundaystandard.info/feed/", kind: "rss", region: "BW" },
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
  { name: "Ethiopia — The Reporter", url: "https://www.thereporterethiopia.com/", kind: "html", region: "ET" },
  // ── Middle East & North Africa ──
  { name: "The Times of Israel", url: "https://www.timesofisrael.com/feed/", kind: "rss", region: "IL" },
  { name: "The Jerusalem Post", url: "https://www.jpost.com/rss/rssfeedsheadlines.aspx", kind: "rss", region: "IL" },
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
  { name: "Bangkok Post (Thailand)", url: "https://www.bangkokpost.com/rss/data/news.xml", kind: "rss", region: "TH" },
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