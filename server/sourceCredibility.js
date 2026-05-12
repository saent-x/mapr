import { ensureDatabase, readEventArticles, readSourceCredibilityByKey } from './storage.js';
import { readSourceCatalog } from './sourceCatalog.js';

let _catalogCache = null;
let _catalogCacheTs = 0;
async function getCatalogMap() {
  if (_catalogCache && Date.now() - _catalogCacheTs < 5 * 60_000) return _catalogCache;
  try {
    const catalog = await readSourceCatalog();
    const map = new Map();
    for (const entry of catalog || []) {
      if (!entry) continue;
      const key = (entry.id || entry.sourceKey || entry.feedId || '').toLowerCase();
      if (key) map.set(key, entry);
      if (entry.host) map.set(String(entry.host).toLowerCase(), entry);
      if (entry.url) {
        try { map.set(new URL(entry.url).hostname.replace(/^www\./, '').toLowerCase(), entry); }
        catch { /* ignore */ }
      }
    }
    _catalogCache = map;
    _catalogCacheTs = Date.now();
    return map;
  } catch {
    _catalogCache = new Map();
    _catalogCacheTs = Date.now();
    return _catalogCache;
  }
}

function host(url) {
  try { return new URL(url).hostname.replace(/^www\./, ''); }
  catch { return ''; }
}

function reliabilityTier(score) {
  if (score == null) return 'unknown';
  if (score >= 0.7) return 'high';
  if (score >= 0.4) return 'medium';
  return 'low';
}

/**
 * Build the source credibility breakdown for an event:
 *  - first publisher (earliest publishedAt)
 *  - corroborating outlets (unique sources sorted by recency)
 *  - per-source score, reliability tier, bias lean (if catalog has it)
 *  - single-source warning
 *  - cached LLM explanation per source (if present in credibility_explanations)
 */
export async function buildCredibilityForEvent(eventId) {
  const articles = await readEventArticles(eventId);
  if (!articles?.length) {
    return {
      eventId,
      sources: [],
      firstPublisher: null,
      uniqueSourceCount: 0,
      singleSourceWarning: false,
      generatedAt: new Date().toISOString(),
    };
  }

  // Group by source key (host for now, falls back to declared source string).
  const buckets = new Map();
  for (const a of articles) {
    const key = (host(a.url) || (a.source || '').toLowerCase().replace(/\s+/g, '-') || 'unknown').toLowerCase();
    let bucket = buckets.get(key);
    if (!bucket) {
      bucket = {
        sourceKey: key,
        sourceName: a.source || key,
        articles: [],
      };
      buckets.set(key, bucket);
    }
    bucket.articles.push(a);
  }

  const db = await ensureDatabase();
  const sourceKeys = [...buckets.keys()];
  const explanations = sourceKeys.length
    ? (await db.query(
        'SELECT "sourceKey", explanation, "scoreAtGeneration", "generatedAt" FROM credibility_explanations WHERE "sourceKey" = ANY($1)',
        [sourceKeys],
      )).rows
    : [];
  const explanationByKey = new Map(explanations.map((r) => [r.sourceKey, r]));

  const catalogMap = await getCatalogMap();
  const sources = [];
  for (const bucket of buckets.values()) {
    const cred = await readSourceCredibilityByKey(bucket.sourceKey).catch(() => null);
    const meta = catalogMap.get(bucket.sourceKey) || null;
    bucket.articles.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
    const earliest = bucket.articles[bucket.articles.length - 1];
    sources.push({
      sourceKey: bucket.sourceKey,
      sourceName: bucket.sourceName,
      articleCount: bucket.articles.length,
      latestArticle: bucket.articles[0]
        ? {
            id: bucket.articles[0].id,
            title: bucket.articles[0].title,
            url: bucket.articles[0].url,
            publishedAt: bucket.articles[0].publishedAt,
          }
        : null,
      firstPublishedAt: earliest?.publishedAt || null,
      score: cred?.score ?? null,
      totalEvents: cred?.totalEvents ?? null,
      corroboratedEvents: cred?.corroboratedEvents ?? null,
      reliabilityTier: reliabilityTier(cred?.score),
      biasLean: meta?.biasLean || null,
      stateMedia: Boolean(meta?.stateMedia),
      sourceType: meta?.sourceType || null,
      explanation: explanationByKey.get(bucket.sourceKey)?.explanation || null,
    });
  }

  // Sort: highest article count first, then most reliable.
  sources.sort((a, b) => {
    if (b.articleCount !== a.articleCount) return b.articleCount - a.articleCount;
    return (b.score ?? 0) - (a.score ?? 0);
  });

  // First publisher = whoever had the earliest publishedAt.
  let firstPublisher = null;
  for (const src of sources) {
    if (!src.firstPublishedAt) continue;
    const ts = new Date(src.firstPublishedAt).getTime();
    if (!firstPublisher || ts < firstPublisher.ts) {
      firstPublisher = { sourceKey: src.sourceKey, sourceName: src.sourceName, publishedAt: src.firstPublishedAt, ts };
    }
  }

  return {
    eventId,
    sources,
    firstPublisher: firstPublisher
      ? { sourceKey: firstPublisher.sourceKey, sourceName: firstPublisher.sourceName, publishedAt: firstPublisher.publishedAt }
      : null,
    uniqueSourceCount: sources.length,
    singleSourceWarning: sources.length <= 1,
    generatedAt: new Date().toISOString(),
  };
}

export async function upsertCredibilityExplanation({ sourceKey, scoreAtGeneration, explanation }) {
  if (!sourceKey || !explanation) return;
  const db = await ensureDatabase();
  await db.query(
    `INSERT INTO credibility_explanations ("sourceKey", "scoreAtGeneration", explanation, "generatedAt")
     VALUES ($1, $2, $3, $4)
     ON CONFLICT ("sourceKey") DO UPDATE SET
       "scoreAtGeneration" = EXCLUDED."scoreAtGeneration",
       explanation = EXCLUDED.explanation,
       "generatedAt" = EXCLUDED."generatedAt"`,
    [sourceKey, scoreAtGeneration ?? 0, explanation, new Date().toISOString()],
  );
}
