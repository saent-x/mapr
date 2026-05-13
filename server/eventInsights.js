/**
 * server/eventInsights.js — small LLM-backed insight cards for event detail.
 *
 * D6: reporter prompt — questions sources didn't answer + reporters on the beat.
 * D7: why-now context — what trend this event continues, what precedents apply.
 *
 * Both share the (eventId, eventLastUpdatedAt) cache pattern used elsewhere
 * in the codebase (see briefs.js, contradictions.js).
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureDatabase, readEventById, readEventArticles, readActiveEvents } from './storage.js';
import { generate as aiGenerate } from './ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPORTER_SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'reporterPrompt.schema.json'), 'utf8'));
const WHY_NOW_SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'whyNow.schema.json'), 'utf8'));

const MAX_ARTICLES = 6;
const MAX_PRIOR_EVENTS = 6;
const MAX_SUMMARY_CHARS = 600;

function clamp(s, n) { return String(s || '').slice(0, n); }
function nowIso() { return new Date().toISOString(); }
function parseJson(raw, fallback) {
  if (!raw) return fallback;
  try { return JSON.parse(raw); } catch { return fallback; }
}

function getArticlePayloadSummary(a) {
  const payload = parseJson(a.payload, {});
  return clamp(payload.summary || '', MAX_SUMMARY_CHARS);
}

function eventEntityNames(event, articles) {
  const names = new Set();
  const ents = event.entities || {};
  for (const kind of ['people', 'organizations', 'locations']) {
    for (const item of (ents[kind] || [])) {
      const n = typeof item === 'string' ? item : item?.name;
      if (n) names.add(String(n));
    }
  }
  for (const a of articles) {
    const payload = parseJson(a.payload, {});
    const aents = payload.entities || {};
    for (const kind of ['people', 'organizations', 'locations']) {
      for (const item of (aents[kind] || [])) {
        const n = typeof item === 'string' ? item : item?.name;
        if (n) names.add(String(n));
      }
    }
  }
  return [...names].slice(0, 20);
}

/**
 * Find events from the corpus that share at least one named entity with
 * the focal event, excluding the focal event itself. Used as "precedent"
 * context for the why-now generator.
 */
async function readEntitySharedEvents(event, articles, limit = MAX_PRIOR_EVENTS) {
  const targetNames = new Set(eventEntityNames(event, articles).map((n) => n.toLowerCase()));
  if (!targetNames.size) return [];
  const events = await readActiveEvents({ maxAgeHours: 30 * 24 });
  const scored = [];
  for (const ev of events) {
    if (ev.id === event.id) continue;
    const ents = ev.entities || {};
    let overlap = 0;
    for (const kind of ['people', 'organizations', 'locations']) {
      for (const item of (ents[kind] || [])) {
        const n = String(typeof item === 'string' ? item : item?.name || '').toLowerCase();
        if (n && targetNames.has(n)) overlap += 1;
      }
    }
    if (overlap > 0) scored.push({ ev, overlap });
  }
  return scored
    .sort((a, b) => {
      if (b.overlap !== a.overlap) return b.overlap - a.overlap;
      return new Date(b.ev.lastUpdatedAt || 0) - new Date(a.ev.lastUpdatedAt || 0);
    })
    .slice(0, limit)
    .map(({ ev, overlap }) => ({
      id: ev.id,
      title: ev.title,
      lastUpdatedAt: ev.lastUpdatedAt,
      severity: ev.severity,
      lifecycle: ev.lifecycle,
      region: ev.primaryCountry || ev.isoA2 || '',
      overlap,
    }));
}

// ── D6: Reporter prompt ─────────────────────────────────────────────

export async function readLatestReporterPrompt(eventId) {
  const db = await ensureDatabase();
  const { rows } = await db.query(
    'SELECT * FROM event_reporter_prompts WHERE "eventId" = $1 LIMIT 1',
    [eventId],
  );
  if (!rows[0]) return null;
  return {
    eventId: rows[0].eventId,
    eventLastUpdatedAt: rows[0].eventLastUpdatedAt,
    questions: parseJson(rows[0].questions, []),
    reporters: parseJson(rows[0].reporters, []),
    modelUsed: rows[0].modelUsed,
    generatedAt: rows[0].generatedAt,
  };
}

async function persistReporterPrompt({ eventId, eventLastUpdatedAt, questions, reporters, modelUsed }) {
  const db = await ensureDatabase();
  const ts = nowIso();
  await db.query(
    `INSERT INTO event_reporter_prompts ("eventId", "eventLastUpdatedAt", questions, reporters, "modelUsed", "generatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("eventId") DO UPDATE SET
       "eventLastUpdatedAt" = EXCLUDED."eventLastUpdatedAt",
       questions = EXCLUDED.questions,
       reporters = EXCLUDED.reporters,
       "modelUsed" = EXCLUDED."modelUsed",
       "generatedAt" = EXCLUDED."generatedAt"`,
    [eventId, eventLastUpdatedAt, JSON.stringify(questions), JSON.stringify(reporters), modelUsed || '', ts],
  );
  return { eventId, eventLastUpdatedAt, questions, reporters, modelUsed, generatedAt: ts };
}

export async function generateReporterPromptForEvent({ eventId, force = false } = {}) {
  if (!eventId) throw Object.assign(new Error('eventId required'), { statusCode: 400 });
  const event = await readEventById(eventId);
  if (!event) throw Object.assign(new Error('event not found'), { statusCode: 404 });
  const lastUpdated = event.lastUpdatedAt || event.firstSeenAt || nowIso();

  if (!force) {
    const db = await ensureDatabase();
    const { rows } = await db.query(
      `SELECT * FROM event_reporter_prompts
        WHERE "eventId" = $1 AND "eventLastUpdatedAt" = $2`,
      [eventId, lastUpdated],
    );
    if (rows[0]) {
      return {
        eventId,
        eventLastUpdatedAt: lastUpdated,
        questions: parseJson(rows[0].questions, []),
        reporters: parseJson(rows[0].reporters, []),
        modelUsed: rows[0].modelUsed,
        generatedAt: rows[0].generatedAt,
        cached: true,
      };
    }
  }

  const articles = await readEventArticles(eventId);
  const articlesForPrompt = articles.slice(0, MAX_ARTICLES).map((a) => ({
    title: clamp(a.title, 200),
    source: a.source || '',
    summary: getArticlePayloadSummary(a),
    url: a.url || '',
  }));

  // Pull bylines from article payloads — when present, the LLM can surface
  // them as "reporters who cover this beat".
  const bylinesSeen = new Set();
  const bylines = [];
  for (const a of articles) {
    const payload = parseJson(a.payload, {});
    const byline = payload.byline || payload.author || null;
    if (byline && !bylinesSeen.has(byline)) {
      bylinesSeen.add(byline);
      bylines.push({ name: byline, outlet: a.source || '' });
      if (bylines.length >= 12) break;
    }
  }

  const result = await aiGenerate({
    task: 'reporter_prompt',
    input: {
      event: {
        id: event.id,
        title: event.title,
        region: event.primaryCountry || event.isoA2 || '',
        category: event.category,
        lifecycle: event.lifecycle,
      },
      articles: articlesForPrompt,
      observed_bylines: bylines,
      instructions: [
        'List up to 6 important questions the sources have NOT answered.',
        'Pick questions a working journalist could plausibly chase next — not editorial framing.',
        'Then list up to 5 reporters / outlets who cover this beat well.',
        'Prefer names from observed_bylines when they appear; otherwise name well-known beat reporters at the outlets you see.',
        'Never invent specific reporter names you cannot verify; if unsure, name the outlet only.',
      ].join(' '),
    },
    schema: REPORTER_SCHEMA,
    maxTokens: 768,
    temperature: 0.3,
  });

  const out = result?.output || {};
  const questions = (Array.isArray(out.questions) ? out.questions : [])
    .filter((q) => q && typeof q.question === 'string')
    .slice(0, 6);
  const reporters = (Array.isArray(out.reporters) ? out.reporters : [])
    .filter((r) => r && typeof r.name === 'string')
    .slice(0, 5);

  return persistReporterPrompt({
    eventId,
    eventLastUpdatedAt: lastUpdated,
    questions,
    reporters,
    modelUsed: result?.model || 'unknown',
  });
}

// ── D7: Why-now historical context ──────────────────────────────────

export async function readLatestWhyNow(eventId) {
  const db = await ensureDatabase();
  const { rows } = await db.query(
    'SELECT * FROM event_why_now WHERE "eventId" = $1 LIMIT 1',
    [eventId],
  );
  if (!rows[0]) return null;
  return {
    eventId: rows[0].eventId,
    eventLastUpdatedAt: rows[0].eventLastUpdatedAt,
    context: rows[0].context,
    precedents: parseJson(rows[0].precedents, []),
    modelUsed: rows[0].modelUsed,
    generatedAt: rows[0].generatedAt,
  };
}

async function persistWhyNow({ eventId, eventLastUpdatedAt, context, precedents, modelUsed }) {
  const db = await ensureDatabase();
  const ts = nowIso();
  await db.query(
    `INSERT INTO event_why_now ("eventId", "eventLastUpdatedAt", context, precedents, "modelUsed", "generatedAt")
       VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT ("eventId") DO UPDATE SET
       "eventLastUpdatedAt" = EXCLUDED."eventLastUpdatedAt",
       context = EXCLUDED.context,
       precedents = EXCLUDED.precedents,
       "modelUsed" = EXCLUDED."modelUsed",
       "generatedAt" = EXCLUDED."generatedAt"`,
    [eventId, eventLastUpdatedAt, context || '', JSON.stringify(precedents || []), modelUsed || '', ts],
  );
  return { eventId, eventLastUpdatedAt, context, precedents, modelUsed, generatedAt: ts };
}

export async function generateWhyNowForEvent({ eventId, force = false } = {}) {
  if (!eventId) throw Object.assign(new Error('eventId required'), { statusCode: 400 });
  const event = await readEventById(eventId);
  if (!event) throw Object.assign(new Error('event not found'), { statusCode: 404 });
  const lastUpdated = event.lastUpdatedAt || event.firstSeenAt || nowIso();

  if (!force) {
    const db = await ensureDatabase();
    const { rows } = await db.query(
      'SELECT * FROM event_why_now WHERE "eventId" = $1 AND "eventLastUpdatedAt" = $2',
      [eventId, lastUpdated],
    );
    if (rows[0]) {
      return {
        eventId,
        eventLastUpdatedAt: lastUpdated,
        context: rows[0].context,
        precedents: parseJson(rows[0].precedents, []),
        modelUsed: rows[0].modelUsed,
        generatedAt: rows[0].generatedAt,
        cached: true,
      };
    }
  }

  const articles = await readEventArticles(eventId);
  const priorEvents = await readEntitySharedEvents(event, articles);

  const result = await aiGenerate({
    task: 'why_now',
    input: {
      event: {
        id: event.id,
        title: event.title,
        region: event.primaryCountry || event.isoA2 || '',
        firstSeenAt: event.firstSeenAt,
        lastUpdatedAt: event.lastUpdatedAt,
        category: event.category,
        lifecycle: event.lifecycle,
      },
      recent_articles: articles.slice(0, MAX_ARTICLES).map((a) => ({
        title: clamp(a.title, 200),
        publishedAt: a.publishedAt,
        source: a.source || '',
      })),
      prior_events_sharing_entities: priorEvents,
      instructions: [
        'Write 2-4 sentences answering "why now?" — what trend this event continues and what precedent (from prior_events_sharing_entities or general knowledge of the region/topic) it mirrors.',
        'Stay grounded: never invent facts beyond what the prior coverage supports.',
        'If genuinely novel and without precedent, say so plainly.',
        'In the precedents array, surface up to 4 entries from prior_events_sharing_entities that are the strongest analogues. Use their event ids verbatim.',
      ].join(' '),
    },
    schema: WHY_NOW_SCHEMA,
    maxTokens: 512,
    temperature: 0.3,
  });

  const out = result?.output || {};
  const knownIds = new Set(priorEvents.map((e) => e.id));
  const precedents = (Array.isArray(out.precedents) ? out.precedents : [])
    .filter((p) => p && typeof p.label === 'string')
    .map((p) => ({
      label: p.label,
      approxDate: p.approxDate || '',
      eventId: knownIds.has(p.eventId) ? p.eventId : null,
    }))
    .slice(0, 4);

  return persistWhyNow({
    eventId,
    eventLastUpdatedAt: lastUpdated,
    context: typeof out.context === 'string' ? out.context : '',
    precedents,
    modelUsed: result?.model || 'unknown',
  });
}

export const __test__ = { eventEntityNames };
