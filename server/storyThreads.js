import crypto from 'node:crypto';
import { ensureDatabase } from './storage.js';

function nowIso() { return new Date().toISOString(); }

function newThreadId() {
  return 'thr_' + crypto.randomBytes(9).toString('base64url');
}

function rowToThread(row, articleCount = 0) {
  return {
    id: row.id,
    ownerUserId: row.ownerUserId,
    title: row.title,
    seedEventId: row.seedEventId,
    seedArticleId: row.seedArticleId,
    pinnedAt: row.pinnedAt,
    lastActivityAt: row.lastActivityAt,
    status: row.status,
    articleCount: Number(articleCount) || 0,
  };
}

export async function listThreadsForUser({ userId, status = 'active', limit = 100 } = {}) {
  if (!userId) return [];
  const db = await ensureDatabase();
  const { rows } = await db.query(
    `SELECT t.*, COALESCE(c.cnt, 0) AS "articleCount"
       FROM story_threads t
       LEFT JOIN (
         SELECT "threadId", COUNT(*)::int AS cnt
           FROM story_thread_articles
          GROUP BY "threadId"
       ) c ON c."threadId" = t.id
      WHERE t."ownerUserId" = $1 AND t.status = $2
      ORDER BY t."lastActivityAt" DESC
      LIMIT $3`,
    [userId, status, limit],
  );
  return rows.map((r) => rowToThread(r, r.articleCount));
}

export async function createThread({ userId, title, seedEventId = null, seedArticleId = null }) {
  if (!userId) throw Object.assign(new Error('userId required'), { statusCode: 400 });
  const cleanTitle = String(title || '').trim().slice(0, 200);
  if (!cleanTitle) throw Object.assign(new Error('title required'), { statusCode: 400 });

  const db = await ensureDatabase();
  const existing = await db.query(
    `SELECT id FROM story_threads
      WHERE "ownerUserId" = $1
        AND status = 'active'
        AND ("seedEventId" = $2 OR "seedArticleId" = $3)
      LIMIT 1`,
    [userId, seedEventId, seedArticleId],
  );
  if (existing.rows[0]) {
    const { rows } = await db.query(
      `SELECT * FROM story_threads WHERE id = $1`,
      [existing.rows[0].id],
    );
    return rowToThread(rows[0]);
  }

  const id = newThreadId();
  const ts = nowIso();
  await db.query(
    `INSERT INTO story_threads
       (id, "ownerUserId", title, "seedEventId", "seedArticleId", "pinnedAt", "lastActivityAt", status)
     VALUES ($1, $2, $3, $4, $5, $6, $6, 'active')`,
    [id, userId, cleanTitle, seedEventId, seedArticleId, ts],
  );

  if (seedArticleId) {
    await db.query(
      `INSERT INTO story_thread_articles ("threadId", "articleId", similarity, diff, "addedAt")
         VALUES ($1, $2, 1, NULL, $3)
         ON CONFLICT DO NOTHING`,
      [id, seedArticleId, ts],
    ).catch(() => { /* article may not be in articles table yet */ });
  }

  return rowToThread({
    id, ownerUserId: userId, title: cleanTitle, seedEventId, seedArticleId,
    pinnedAt: ts, lastActivityAt: ts, status: 'active',
  });
}

export async function archiveThread({ userId, threadId }) {
  if (!userId || !threadId) throw Object.assign(new Error('userId+threadId required'), { statusCode: 400 });
  const db = await ensureDatabase();
  const { rowCount } = await db.query(
    `UPDATE story_threads SET status = 'archived'
      WHERE id = $1 AND "ownerUserId" = $2`,
    [threadId, userId],
  );
  return rowCount > 0;
}
