/**
 * server/beats/profile.js — per-user beat description + embedding.
 *
 * The user types a paragraph describing their beat in plain English.
 * We embed it via bge-m3 (same model as articles.embedding) so the
 * match endpoint can run a single cosine query against the corpus.
 */

import { ensureDatabase } from '../storage.js';
import { embed as aiEmbed } from '../ai/client.js';

const MIN_LEN = 12;
const MAX_LEN = 2000;

let _embeddingColumnReady = null;

/**
 * Lazily install the embedding column. pgvector is enabled in production
 * by scripts/backfill-embeddings.js; if it's somehow absent we log and
 * fall back to text-only profiles (matches will be empty).
 */
async function ensureEmbeddingColumn() {
  if (_embeddingColumnReady) return _embeddingColumnReady;
  _embeddingColumnReady = (async () => {
    const db = await ensureDatabase();
    try {
      await db.query('CREATE EXTENSION IF NOT EXISTS vector');
      await db.query(
        'ALTER TABLE user_beat_profiles ADD COLUMN IF NOT EXISTS embedding vector(1024)',
      );
      return true;
    } catch (err) {
      console.warn('[beats] pgvector unavailable, beat matches disabled:', err.message);
      return false;
    }
  })();
  return _embeddingColumnReady;
}

function nowIso() { return new Date().toISOString(); }

function clampDescription(raw) {
  const s = String(raw || '').trim();
  if (!s) throw Object.assign(new Error('beat description required'), { statusCode: 400 });
  if (s.length < MIN_LEN) throw Object.assign(new Error(`beat description must be at least ${MIN_LEN} characters`), { statusCode: 400 });
  return s.slice(0, MAX_LEN);
}

function vectorLiteral(vec) {
  return `[${vec.map((v) => Number(v).toFixed(6)).join(',')}]`;
}

export async function readBeatProfile(userId) {
  if (!userId) return null;
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT "userId", description, "embeddingModel", "updatedAt", "createdAt"
       FROM user_beat_profiles WHERE "userId" = $1`,
    [userId],
  );
  return rows[0] || null;
}

export async function readBeatProfileWithEmbedding(userId) {
  if (!userId) return null;
  const haveColumn = await ensureEmbeddingColumn();
  const db = await ensureDatabase();
  const select = haveColumn
    ? 'SELECT "userId", description, embedding, "embeddingModel", "updatedAt" FROM user_beat_profiles WHERE "userId" = $1'
    : 'SELECT "userId", description, NULL::text AS embedding, "embeddingModel", "updatedAt" FROM user_beat_profiles WHERE "userId" = $1';
  const { rows } = await db.query(select, [userId]);
  return rows[0] || null;
}

export async function upsertBeatProfile({ userId, description }) {
  if (!userId) throw Object.assign(new Error('userId required'), { statusCode: 401 });
  const clean = clampDescription(description);

  const haveColumn = await ensureEmbeddingColumn();
  let embeddingLiteral = null;
  let model = null;
  if (haveColumn) {
    const result = await aiEmbed({ inputs: [clean], normalize: true });
    const vec = result?.vectors?.[0];
    if (Array.isArray(vec) && vec.length) {
      embeddingLiteral = vectorLiteral(vec);
      model = result?.model || 'bge-m3';
    }
  }

  const db = await ensureDatabase();
  const ts = nowIso();
  if (haveColumn && embeddingLiteral) {
    await db.query(
      `INSERT INTO user_beat_profiles ("userId", description, embedding, "embeddingModel", "updatedAt", "createdAt")
         VALUES ($1, $2, $3::vector, $4, $5, $5)
       ON CONFLICT ("userId") DO UPDATE SET
         description = EXCLUDED.description,
         embedding = EXCLUDED.embedding,
         "embeddingModel" = EXCLUDED."embeddingModel",
         "updatedAt" = EXCLUDED."updatedAt"`,
      [userId, clean, embeddingLiteral, model, ts],
    );
  } else {
    await db.query(
      `INSERT INTO user_beat_profiles ("userId", description, "embeddingModel", "updatedAt", "createdAt")
         VALUES ($1, $2, NULL, $3, $3)
       ON CONFLICT ("userId") DO UPDATE SET
         description = EXCLUDED.description,
         "embeddingModel" = NULL,
         "updatedAt" = EXCLUDED."updatedAt"`,
      [userId, clean, ts],
    );
  }
  return readBeatProfile(userId);
}

export async function deleteBeatProfile(userId) {
  if (!userId) return false;
  const db = await ensureDatabase();
  const { rowCount } = await db.query(
    'DELETE FROM user_beat_profiles WHERE "userId" = $1',
    [userId],
  );
  return rowCount > 0;
}

export const __test__ = { clampDescription, vectorLiteral, MIN_LEN, MAX_LEN };
