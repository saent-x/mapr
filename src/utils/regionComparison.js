import { HIGH_FREQUENCY_ENTITIES } from './geopoliticalArcs.js';

const ENTITY_TYPES = [
  ['people', 'person'],
  ['organizations', 'organization'],
  ['locations', 'location'],
];

const ENTITY_DENYLIST = new Set([
  'AP', 'Associated Press', 'Reuters', 'BBC', 'BBC News', 'CNN', 'France 24',
  'Al Jazeera', 'The Guardian', 'New York Times', 'Washington Post',
  'Victory Day', 'Palestine Marathon', 'First Thing', 'Middle East',
  'United States', 'Estados Unidos',
]);

function normalizeEntityName(name) {
  return String(name || '').trim().replace(/\s+/g, ' ');
}

function entityKey(type, name) {
  return `${type}:${normalizeEntityName(name).toLowerCase()}`;
}

function isUsefulEntity(type, name) {
  const normalized = normalizeEntityName(name);
  if (normalized.length < 4) return false;
  if (/[’']s$/i.test(normalized)) return false;
  if (normalized.split(/\s+/).length > 5) return false;
  if (/\s(and|y|et|و)\s/i.test(normalized)) return false;
  if (HIGH_FREQUENCY_ENTITIES.has(normalized)) return false;
  if (ENTITY_DENYLIST.has(normalized)) return false;
  if (type === 'location' && normalized.length < 5) return false;
  return true;
}

function iterEntityMentions(article) {
  const mentions = [];
  if (!article?.entities) return mentions;
  for (const [field, type] of ENTITY_TYPES) {
    const values = Array.isArray(article.entities[field]) ? article.entities[field] : [];
    for (const raw of values) {
      const name = normalizeEntityName(typeof raw === 'string' ? raw : raw?.name);
      if (!isUsefulEntity(type, name)) continue;
      mentions.push({
        key: entityKey(type, name),
        name,
        type,
      });
    }
  }
  return mentions;
}

export function buildSeverityTrend(articles, daysBack = 30, nowMs = Date.now()) {
  if (!articles || articles.length === 0) return [];
  const buckets = new Map();
  const msPerDay = 86400000;

  for (let i = daysBack - 1; i >= 0; i--) {
    const dayStart = new Date(nowMs - i * msPerDay).toISOString().slice(0, 10);
    buckets.set(dayStart, { totalSeverity: 0, count: 0, critical: 0 });
  }

  for (const article of articles) {
    const ts = article.firstSeenAt || article.publishedAt;
    if (!ts) continue;
    const day = new Date(ts).toISOString().slice(0, 10);
    const bucket = buckets.get(day);
    if (!bucket) continue;
    const severity = article.severity || 0;
    bucket.totalSeverity += severity;
    bucket.count += 1;
    if (severity >= 70) bucket.critical += 1;
  }

  return [...buckets.entries()].map(([date, bucket]) => ({
    date,
    value: bucket.count > 0 ? bucket.totalSeverity / bucket.count / 10 : 0,
    avgSeverity: bucket.count > 0 ? bucket.totalSeverity / bucket.count : 0,
    count: bucket.count,
    critical: bucket.critical,
  }));
}

export function summarizeRegionArticles(articles = []) {
  const sourceSet = new Set();
  let totalSeverity = 0;
  let critical = 0;
  let latestTs = 0;

  for (const article of articles) {
    totalSeverity += article.severity || 0;
    if ((article.severity || 0) >= 70) critical += 1;
    if (article.source) sourceSet.add(article.source);
    const ts = new Date(article.firstSeenAt || article.publishedAt || 0).getTime();
    if (Number.isFinite(ts)) latestTs = Math.max(latestTs, ts);
  }

  return {
    avgSev: articles.length ? totalSeverity / articles.length / 10 : 0,
    eventCount: articles.length,
    sourceCount: sourceSet.size,
    criticalCount: critical,
    latestTs,
  };
}

function buildEntityEvidence(articles = []) {
  const map = new Map();
  for (const article of articles) {
    const seenInArticle = new Set();
    for (const mention of iterEntityMentions(article)) {
      if (seenInArticle.has(mention.key)) continue;
      seenInArticle.add(mention.key);

      const current = map.get(mention.key) || {
        key: mention.key,
        name: mention.name,
        type: mention.type,
        eventIds: new Set(),
        sources: new Set(),
        titles: [],
        severityTotal: 0,
        latestTs: 0,
      };
      current.eventIds.add(article.id || article.url || article.title);
      if (article.source) current.sources.add(article.source);
      if (article.title && current.titles.length < 3) current.titles.push(article.title);
      current.severityTotal += article.severity || 0;
      const ts = new Date(article.firstSeenAt || article.publishedAt || 0).getTime();
      if (Number.isFinite(ts)) current.latestTs = Math.max(current.latestTs, ts);
      map.set(mention.key, current);
    }
  }
  return map;
}

export function buildSharedEntityEvidence(articlesA = [], articlesB = [], { limit = 12 } = {}) {
  const entitiesA = buildEntityEvidence(articlesA);
  const entitiesB = buildEntityEvidence(articlesB);
  const shared = [];

  for (const [key, left] of entitiesA) {
    const right = entitiesB.get(key);
    if (!right) continue;
    const leftCount = left.eventIds.size;
    const rightCount = right.eventIds.size;
    const sourceCount = new Set([...left.sources, ...right.sources]).size;
    const totalEvents = leftCount + rightCount;
    const avgSeverity = totalEvents
      ? (left.severityTotal + right.severityTotal) / totalEvents
      : 0;

    shared.push({
      key,
      name: left.name,
      type: left.type,
      leftCount,
      rightCount,
      sourceCount,
      avgSeverity,
      latestTs: Math.max(left.latestTs, right.latestTs),
      evidenceTitles: [...left.titles, ...right.titles].slice(0, 4),
      score: totalEvents * 2 + sourceCount + avgSeverity / 20,
    });
  }

  shared.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return b.latestTs - a.latestTs;
  });
  return shared.slice(0, limit);
}
