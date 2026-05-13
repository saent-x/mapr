/**
 * server/contradictions.js — per-event source contradiction extraction.
 *
 * Given the articles tied to an event, ask the LLM to identify factual
 * claims that different sources disagree on (casualty counts, identities,
 * sequence, dates, attribution). Cached in event_contradictions keyed
 * by (eventId, eventLastUpdatedAt); the cache invalidates when the
 * event's lastUpdatedAt advances, matching the brief-generator pattern.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureDatabase, readEventArticles, readEventById } from './storage.js';
import { generate as aiGenerate } from './ai/client.js';
import { buildCredibilityForEvent } from './sourceCredibility.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'contradictions.schema.json'), 'utf8'));

const MAX_SOURCES = 12;
const MAX_ARTICLE_TEXT = 600;

function clamp(s, n) { return String(s || '').slice(0, n); }

function nowIso() { return new Date().toISOString(); }

function articleHost(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

function sourceKeyForArticle(article) {
  return (articleHost(article.url) || String(article.source || '').toLowerCase().replace(/\s+/g, '-') || 'unknown').toLowerCase();
}

function parsePayload(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function buildInputForLlm(event, articles, validKeys) {
  const trimmed = articles.slice(0, MAX_SOURCES).map((a, i) => {
    const payload = parsePayload(a.payload);
    return {
      index: i + 1,
      sourceKey: sourceKeyForArticle(a),
      source: a.source || sourceKeyForArticle(a),
      title: clamp(a.title, 200),
      summary: clamp(payload.summary, MAX_ARTICLE_TEXT),
      publishedAt: a.publishedAt || null,
    };
  });
  return {
    event: {
      id: event.id,
      title: event.title,
      lifecycle: event.lifecycle,
      severity: event.severity,
      region: event.primaryCountry || event.isoA2 || '',
      lastUpdatedAt: event.lastUpdatedAt,
    },
    articles: trimmed,
    valid_source_keys: [...validKeys].slice(0, 32),
    instructions: [
      'Identify up to 6 specific factual claims where the sources disagree.',
      'Each claim must reference at least two sourceKey values from valid_source_keys.',
      'Prefer concrete disputed facts (casualty counts, who fired first, dates) over framing or tone.',
      'When a source simply omits a claim, list it under "unclear", not "refutedBy".',
      'If sources broadly agree, return contradictions: [].',
    ].join(' '),
  };
}

function filterToValidSources(rawContradictions, validKeys) {
  const valid = new Set(validKeys);
  return rawContradictions
    .filter((c) => c && typeof c.claim === 'string')
    .map((c) => {
      const sup = (c.supportedBy || []).filter((k) => valid.has(String(k).toLowerCase()));
      const ref = (c.refutedBy || []).filter((k) => valid.has(String(k).toLowerCase()));
      const unc = (c.unclear || []).filter((k) => valid.has(String(k).toLowerCase()));
      // A contradiction needs ≥2 sources across sup+ref to be meaningful.
      if (sup.length + ref.length < 2) return null;
      return {
        claim: c.claim,
        category: c.category || 'other',
        supportedBy: sup,
        refutedBy: ref,
        unclear: unc,
        confidence: c.confidence || 'medium',
      };
    })
    .filter(Boolean)
    .slice(0, 6);
}

export async function readCachedContradictions(eventId, eventLastUpdatedAt) {
  if (!eventId) return null;
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT * FROM event_contradictions
      WHERE "eventId" = $1 AND "eventLastUpdatedAt" = $2`,
    [eventId, eventLastUpdatedAt],
  );
  if (!rows[0]) return null;
  return {
    eventId: rows[0].eventId,
    eventLastUpdatedAt: rows[0].eventLastUpdatedAt,
    contradictions: parsePayload(rows[0].contradictions).contradictions || [],
    modelUsed: rows[0].modelUsed,
    generatedAt: rows[0].generatedAt,
  };
}

export async function readLatestContradictions(eventId) {
  if (!eventId) return null;
  const db = await ensureDatabase();
  const { rows } = await db.query(
    'SELECT * FROM event_contradictions WHERE "eventId" = $1 LIMIT 1',
    [eventId],
  );
  if (!rows[0]) return null;
  return {
    eventId: rows[0].eventId,
    eventLastUpdatedAt: rows[0].eventLastUpdatedAt,
    contradictions: parsePayload(rows[0].contradictions).contradictions || [],
    modelUsed: rows[0].modelUsed,
    generatedAt: rows[0].generatedAt,
  };
}

async function persist({ eventId, eventLastUpdatedAt, contradictions, modelUsed }) {
  const db = await ensureDatabase();
  const ts = nowIso();
  await db.query(
    `INSERT INTO event_contradictions ("eventId", "eventLastUpdatedAt", contradictions, "modelUsed", "generatedAt")
       VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT ("eventId") DO UPDATE SET
       "eventLastUpdatedAt" = EXCLUDED."eventLastUpdatedAt",
       contradictions = EXCLUDED.contradictions,
       "modelUsed" = EXCLUDED."modelUsed",
       "generatedAt" = EXCLUDED."generatedAt"`,
    [eventId, eventLastUpdatedAt, JSON.stringify({ contradictions }), modelUsed || '', ts],
  );
  return { eventId, eventLastUpdatedAt, contradictions, modelUsed, generatedAt: ts };
}

export async function generateContradictionsForEvent({ eventId, force = false } = {}) {
  if (!eventId) throw Object.assign(new Error('eventId required'), { statusCode: 400 });
  const event = await readEventById(eventId);
  if (!event) throw Object.assign(new Error('event not found'), { statusCode: 404 });

  const lastUpdated = event.lastUpdatedAt || event.firstSeenAt || nowIso();
  if (!force) {
    const cached = await readCachedContradictions(eventId, lastUpdated);
    if (cached) return { ...cached, cached: true };
  }

  const articles = await readEventArticles(eventId);
  if (articles.length < 2) {
    return persist({ eventId, eventLastUpdatedAt: lastUpdated, contradictions: [], modelUsed: 'n/a' });
  }

  // Pull valid source keys from the credibility builder so the model
  // can only reference sources we actually have on this event.
  const credibility = await buildCredibilityForEvent(eventId).catch(() => null);
  const validKeys = new Set(
    (credibility?.sources || []).map((s) => String(s.sourceKey).toLowerCase()),
  );
  if (validKeys.size < 2) {
    return persist({ eventId, eventLastUpdatedAt: lastUpdated, contradictions: [], modelUsed: 'n/a' });
  }

  const input = buildInputForLlm(event, articles, validKeys);
  const result = await aiGenerate({
    task: 'source_contradictions',
    input,
    schema: SCHEMA,
    maxTokens: 768,
    temperature: 0.1,
  });
  const raw = Array.isArray(result?.output?.contradictions) ? result.output.contradictions : [];
  const contradictions = filterToValidSources(raw, validKeys);
  return persist({
    eventId,
    eventLastUpdatedAt: lastUpdated,
    contradictions,
    modelUsed: result?.model || 'unknown',
  });
}

export const __test__ = { sourceKeyForArticle, filterToValidSources, articleHost };
