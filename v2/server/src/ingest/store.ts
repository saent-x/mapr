import { withTx, type Db } from '../db.js';
import { bandKeys, dedupText, minhash } from '../dedup/minhash.js';
import type { ParsedItem } from '../feeds/parse.js';
import { canonicalUrl } from '../url/canonical.js';

export interface StoreResult {
  seen: number;
  inserted: number;
  insertedIds: number[];
}

/**
 * Insert new articles from one feed. Exact dedup is the canonical URL
 * (articles.url UNIQUE); each new row gets its MinHash signature and LSH bands.
 */
export async function storeItems(
  db: Db,
  sourceId: number,
  items: ParsedItem[],
  opts: { preferHttps: boolean; lang: string | null },
): Promise<StoreResult> {
  const byUrl = new Map<string, ParsedItem>();
  for (const it of items) {
    const url = canonicalUrl(it.link, { preferHttps: opts.preferHttps });
    if (url && !byUrl.has(url)) byUrl.set(url, it);
  }
  if (byUrl.size === 0) return { seen: 0, inserted: 0, insertedIds: [] };

  return withTx(db, async (tx) => {
    const existing = await tx.query<{ url: string }>('SELECT url FROM articles WHERE url = ANY($1::text[])', [[...byUrl.keys()]]);
    for (const r of existing.rows) byUrl.delete(r.url);
    const insertedIds: number[] = [];
    for (const [url, it] of byUrl) {
      const sig = minhash(dedupText(it.title, it.lead));
      const r = await tx.query<{ id: string }>(
        `INSERT INTO articles (source_id, url, title, lead, body_text, lang, published_at, minhash)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         ON CONFLICT (url) DO NOTHING RETURNING id`,
        [sourceId, url, it.title, it.lead || null, it.bodyText || null, opts.lang?.slice(0, 35) ?? null, it.publishedAt, sig],
      );
      const id = r.rows[0] ? Number(r.rows[0].id) : null;
      if (id === null) continue;
      insertedIds.push(id);
      if (sig) {
        await tx.query(
          `INSERT INTO article_bands (band_key, article_id)
           SELECT unnest($1::bigint[]), $2 ON CONFLICT DO NOTHING`,
          [bandKeys(sig), id],
        );
      }
    }
    return { seen: items.length, inserted: insertedIds.length, insertedIds };
  });
}
