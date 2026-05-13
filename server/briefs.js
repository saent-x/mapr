import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureDatabase, readEventArticles } from './storage.js';
import { generate } from './ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BRIEF_SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'brief.schema.json'), 'utf8'));

const MAX_INPUT_ARTICLES = 8;

function parseJson(value, fallback) {
  if (!value) return fallback;
  try { return JSON.parse(value); } catch { return fallback; }
}

function rowToBrief(row) {
  if (!row) return null;
  return {
    eventId: row.eventId,
    eventLastUpdatedAt: row.eventLastUpdatedAt,
    lede: row.lede,
    summary: row.summary,
    actors: parseJson(row.actors, []),
    citations: parseJson(row.citations, []),
    angle: row.angle,
    modelUsed: row.modelUsed,
    generatedAt: row.generatedAt,
    ownerUserId: row.ownerUserId || null,
  };
}

export async function readCachedBrief(eventId, eventLastUpdatedAt) {
  if (!eventId) return null;
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT * FROM briefs WHERE "eventId" = $1 AND "eventLastUpdatedAt" = $2`,
    [eventId, eventLastUpdatedAt],
  );
  return rowToBrief(rows[0]);
}

export async function readLatestBrief(eventId) {
  if (!eventId) return null;
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT * FROM briefs WHERE "eventId" = $1 ORDER BY "generatedAt" DESC LIMIT 1`,
    [eventId],
  );
  return rowToBrief(rows[0]);
}

async function persistBrief({ eventId, eventLastUpdatedAt, output, modelUsed, ownerUserId }) {
  const db = await ensureDatabase();
  const ts = new Date().toISOString();
  await db.query(
    `INSERT INTO briefs ("eventId", "eventLastUpdatedAt", lede, summary, actors, citations, angle, "modelUsed", "generatedAt", "ownerUserId")
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT ("eventId") DO UPDATE SET
       "eventLastUpdatedAt" = EXCLUDED."eventLastUpdatedAt",
       lede = EXCLUDED.lede,
       summary = EXCLUDED.summary,
       actors = EXCLUDED.actors,
       citations = EXCLUDED.citations,
       angle = EXCLUDED.angle,
       "modelUsed" = EXCLUDED."modelUsed",
       "generatedAt" = EXCLUDED."generatedAt",
       "ownerUserId" = EXCLUDED."ownerUserId"`,
    [
      eventId,
      eventLastUpdatedAt,
      output.lede || '',
      output.summary || '',
      JSON.stringify(output.actors || []),
      JSON.stringify(output.citations || []),
      output.angle || '',
      modelUsed || '',
      ts,
      ownerUserId || null,
    ],
  );
  return readCachedBrief(eventId, eventLastUpdatedAt);
}

function buildPrompt(event, articles) {
  const trimmed = articles.slice(0, MAX_INPUT_ARTICLES).map((a, i) => ({
    index: i + 1,
    title: a.title,
    source: a.source || '',
    url: a.url || '',
    publishedAt: a.publishedAt || '',
    summary: (a.summary || '').slice(0, 600),
  }));
  return {
    event: {
      id: event.id,
      title: event.title,
      category: event.category,
      lifecycle: event.lifecycle,
      severity: event.severity,
      region: event.primaryCountry || event.isoA2 || '',
      firstSeenAt: event.firstSeenAt,
      lastUpdatedAt: event.lastUpdatedAt,
    },
    articles: trimmed,
  };
}

/**
 * Returns:
 *   { brief, cached: true }                   — returned from cache
 *   { brief, cached: false }                  — freshly generated
 * Throws:
 *   AI_HOMEPC_NOT_CONFIGURED / AI_WORKERSAI_NOT_CONFIGURED — caller maps to 503
 */
export async function generateBrief({ event, force = false, ownerUserId = null } = {}) {
  if (!event?.id) throw Object.assign(new Error('event required'), { statusCode: 400 });
  const lastUpdated = event.lastUpdatedAt || event.firstSeenAt || new Date().toISOString();

  if (!force) {
    const cached = await readCachedBrief(event.id, lastUpdated);
    if (cached) return { brief: cached, cached: true };
  }

  const articles = await readEventArticles(event.id);
  if (!articles.length) {
    throw Object.assign(new Error('event has no source articles'), { statusCode: 409, code: 'NO_ARTICLES' });
  }

  const input = buildPrompt(event, articles);
  const result = await generate({
    task: 'brief',
    input,
    schema: BRIEF_SCHEMA,
    maxTokens: 768,
    temperature: 0.2,
  });

  const output = result?.output || {};
  // Schema validation is best-effort here — the JSON-schema-constrained
  // generation should already be valid; fall back to coercion if not.
  const coerced = {
    lede: typeof output.lede === 'string' ? output.lede : '',
    summary: typeof output.summary === 'string' ? output.summary : '',
    actors: Array.isArray(output.actors) ? output.actors.slice(0, 6) : [],
    citations: Array.isArray(output.citations) ? output.citations.slice(0, 12) : [],
    angle: typeof output.angle === 'string' ? output.angle : '',
  };
  const brief = await persistBrief({
    eventId: event.id,
    eventLastUpdatedAt: lastUpdated,
    output: coerced,
    modelUsed: result?.model || 'unknown',
    ownerUserId,
  });
  return { brief, cached: false };
}
