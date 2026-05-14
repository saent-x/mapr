/**
 * server/entityDossiers.js — auto-generated dossier per named entity.
 *
 * On first request for an entity (or after a monthly window flip), we
 * gather every recent article that mentions the entity, send the top N
 * to the LLM, and persist a structured dossier:
 *   { summary, role, recentActivity, keyRelationships[], notableQuotes[] }
 *
 * Cache key is (normalizedKey, monthlyWindow) so each calendar month
 * refreshes naturally as new coverage lands.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { ensureDatabase, readArticles } from './storage.js';
import { generate as aiGenerate } from './ai/client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DOSSIER_SCHEMA = JSON.parse(readFileSync(path.join(__dirname, 'ai', 'schemas', 'dossier.schema.json'), 'utf8'));

const MAX_ARTICLES = 12;
const MAX_SUMMARY_CHARS = 500;
const RECENT_WINDOW_HOURS = 30 * 24;
const VALID_TYPES = new Set(['person', 'organization', 'location', 'entity']);

function nowIso() { return new Date().toISOString(); }
function clamp(s, n) { return String(s || '').slice(0, n); }

export function normalizeEntityKey(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')          // strip combining marks
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 160);
}

function currentWindowKey(date = new Date()) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${y}${m}`;
}

function parsePayload(raw) {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return {}; }
}

function entityArrayHas(items = [], normalizedName) {
  for (const item of items) {
    const n = typeof item === 'string' ? item : item?.name;
    if (n && normalizeEntityKey(n) === normalizedName) return true;
  }
  return false;
}

function articleMentionsEntity(article, normalizedName, entityType) {
  const payload = parsePayload(article.payload);
  const ents = payload.entities || {};
  const fields = ['people', 'organizations', 'locations'];
  if (entityType && entityType !== 'entity') {
    const targetField =
      entityType === 'person' ? 'people' :
      entityType === 'organization' ? 'organizations' :
      entityType === 'location' ? 'locations' : null;
    if (targetField && entityArrayHas(ents[targetField], normalizedName)) return true;
  }
  for (const f of fields) {
    if (entityArrayHas(ents[f], normalizedName)) return true;
  }
  // Title-substring fallback for entities the NER step missed.
  const lowerTitle = String(article.title || '').toLowerCase();
  return lowerTitle.includes(String(normalizedName).replace(/-/g, ' '));
}

async function gatherRecentMentions({ normalizedKey, entityType, displayName, limit = MAX_ARTICLES }) {
  // Pull a fat slice of the recent corpus then filter client-side. Costs a
  // single SQL query and avoids a costly substring scan on payload JSON.
  const sinceIso = new Date(Date.now() - RECENT_WINDOW_HOURS * 3600 * 1000).toISOString();
  const articles = await readArticles({ since: sinceIso, limit: 1000 });
  const matches = articles.filter((a) => articleMentionsEntity(a, normalizedKey, entityType));
  // Sort by recency, drop duplicates by url where possible.
  const sorted = matches.sort((a, b) => new Date(b.publishedAt || 0) - new Date(a.publishedAt || 0));
  const seen = new Set();
  const out = [];
  for (const a of sorted) {
    const key = a.url || a.id;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(a);
    if (out.length >= limit) break;
  }
  return out;
}

export async function readCachedDossier({ entityKey, windowKey }) {
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT * FROM entity_dossiers WHERE "entityKey" = $1 AND "windowKey" = $2`,
    [entityKey, windowKey],
  );
  if (!rows[0]) return null;
  const row = rows[0];
  return {
    entityKey: row.entityKey,
    entityType: row.entityType,
    windowKey: row.windowKey,
    displayName: row.displayName,
    summary: row.summary,
    role: row.role || '',
    recentActivity: row.recentActivity || '',
    keyRelationships: parsePayload(row.keyRelationships).items || parsePayload(row.keyRelationships) || [],
    notableQuotes: parsePayload(row.notableQuotes).items || parsePayload(row.notableQuotes) || [],
    articleCount: row.articleCount || 0,
    modelUsed: row.modelUsed || '',
    generatedAt: row.generatedAt,
  };
}

export async function readLatestDossier({ entityKey }) {
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT * FROM entity_dossiers WHERE "entityKey" = $1 ORDER BY "generatedAt" DESC LIMIT 1`,
    [entityKey],
  );
  if (!rows[0]) return null;
  return readCachedDossier({ entityKey, windowKey: rows[0].windowKey });
}

async function persist({ entityKey, entityType, windowKey, displayName, summary, role,
  recentActivity, keyRelationships, notableQuotes, articleCount, modelUsed }) {
  const db = await ensureDatabase();
  const ts = nowIso();
  await db.query(
    `INSERT INTO entity_dossiers (
       "entityKey", "entityType", "windowKey", "displayName", summary, role,
       "recentActivity", "keyRelationships", "notableQuotes",
       "articleCount", "modelUsed", "generatedAt"
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
     ON CONFLICT ("entityKey", "windowKey") DO UPDATE SET
       "entityType" = EXCLUDED."entityType",
       "displayName" = EXCLUDED."displayName",
       summary = EXCLUDED.summary,
       role = EXCLUDED.role,
       "recentActivity" = EXCLUDED."recentActivity",
       "keyRelationships" = EXCLUDED."keyRelationships",
       "notableQuotes" = EXCLUDED."notableQuotes",
       "articleCount" = EXCLUDED."articleCount",
       "modelUsed" = EXCLUDED."modelUsed",
       "generatedAt" = EXCLUDED."generatedAt"`,
    [
      entityKey, entityType, windowKey, displayName, summary, role || '',
      recentActivity || '',
      JSON.stringify({ items: keyRelationships || [] }),
      JSON.stringify({ items: notableQuotes || [] }),
      articleCount || 0, modelUsed || '', ts,
    ],
  );
  return readCachedDossier({ entityKey, windowKey });
}

export async function generateEntityDossier({ name, type = 'entity', force = false } = {}) {
  if (!name) throw Object.assign(new Error('name required'), { statusCode: 400 });
  const safeType = VALID_TYPES.has(type) ? type : 'entity';
  const entityKey = normalizeEntityKey(name);
  if (!entityKey) throw Object.assign(new Error('invalid name'), { statusCode: 400 });
  const windowKey = currentWindowKey();

  if (!force) {
    const cached = await readCachedDossier({ entityKey, windowKey });
    if (cached) return { ...cached, cached: true };
  }

  const articles = await gatherRecentMentions({
    normalizedKey: entityKey, entityType: safeType, displayName: name,
  });

  if (articles.length === 0) {
    // Nothing in the recent corpus — still write a thin row so the UI
    // can show "no recent mentions" without re-querying.
    return persist({
      entityKey, entityType: safeType, windowKey, displayName: name,
      summary: `No coverage of ${name} in the last 30 days.`,
      role: '',
      recentActivity: '',
      keyRelationships: [],
      notableQuotes: [],
      articleCount: 0,
      modelUsed: 'n/a',
    });
  }

  const articlesForPrompt = articles.map((a) => {
    const payload = parsePayload(a.payload);
    return {
      title: clamp(a.title, 200),
      source: a.source || '',
      publishedAt: a.publishedAt || null,
      summary: clamp(payload.summary || '', MAX_SUMMARY_CHARS),
    };
  });

  const result = await aiGenerate({
    task: 'entity_dossier',
    input: {
      entity: { name, type: safeType },
      recent_articles: articlesForPrompt,
      instructions: [
        'Write a neutral dossier describing this entity.',
        'Stay grounded — only state facts the recent_articles support, or widely-known background.',
        "If the entity is ambiguous (e.g. a common name), say so plainly in summary and don't invent biography.",
        'Pick at most 8 keyRelationships from the recent_articles (people, orgs, places that co-appear).',
        'notableQuotes must appear verbatim in the provided articles — never fabricate quotes.',
      ].join(' '),
    },
    schema: DOSSIER_SCHEMA,
    maxTokens: 768,
    temperature: 0.25,
  });

  const out = result?.output || {};
  return persist({
    entityKey,
    entityType: safeType,
    windowKey,
    displayName: name,
    summary: clamp(out.summary, 1200) || `No usable summary returned for ${name}.`,
    role: clamp(out.role || '', 240),
    recentActivity: clamp(out.recentActivity || '', 1200),
    keyRelationships: Array.isArray(out.keyRelationships) ? out.keyRelationships.slice(0, 8) : [],
    notableQuotes: Array.isArray(out.notableQuotes) ? out.notableQuotes.slice(0, 4) : [],
    articleCount: articles.length,
    modelUsed: result?.model || 'unknown',
  });
}

export const __test__ = { normalizeEntityKey, currentWindowKey, articleMentionsEntity };
