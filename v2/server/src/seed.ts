// pnpm seed: upsert sources.json into sources (by url). Operator choices
// (enabled, conditional-GET and failure state) are left alone on existing rows.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
import { createPool, withTx, type Db } from './db.js';
import { log } from './log.js';

export interface SourceSpec {
  name: string;
  url: string;
  kind: 'rss' | 'gdelt';
  region?: string | null;
  category?: string | null;
}

export function validateSources(raw: unknown): SourceSpec[] {
  if (!Array.isArray(raw)) throw new Error('sources file must be a JSON array');
  const seen = new Set<string>();
  return raw.map((s, i) => {
    const r = s as Record<string, unknown>;
    if (typeof r.name !== 'string' || !r.name.trim()) throw new Error(`source ${i}: name missing`);
    if (typeof r.url !== 'string' || !r.url.trim()) throw new Error(`source ${i}: url missing`);
    if (r.kind !== 'rss' && r.kind !== 'gdelt') throw new Error(`source ${i}: kind must be rss or gdelt`);
    if (r.kind === 'rss' && !/^https?:\/\//i.test(r.url)) throw new Error(`source ${i}: rss url must be http(s)`);
    if (seen.has(r.url)) throw new Error(`source ${i}: duplicate url ${r.url}`);
    seen.add(r.url);
    return {
      name: r.name.trim(),
      url: r.url.trim(),
      kind: r.kind,
      region: typeof r.region === 'string' ? r.region : null,
      category: typeof r.category === 'string' ? r.category : null,
    };
  });
}

export async function seedSources(db: Db, specs: SourceSpec[]): Promise<{ inserted: number; updated: number }> {
  return withTx(db, async (tx) => {
    let inserted = 0;
    let updated = 0;
    for (const s of specs) {
      const r = await tx.query<{ inserted: boolean }>(
        `INSERT INTO sources (name, url, kind, region, category, enabled)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (url) DO UPDATE SET
           name = EXCLUDED.name, kind = EXCLUDED.kind, region = EXCLUDED.region, category = EXCLUDED.category
         RETURNING (xmax = 0) AS inserted`,
        // GDELT is not polled yet (see ingest/poller.ts), so it is seeded disabled.
        [s.name, s.url, s.kind, s.region ?? null, s.category ?? null, s.kind === 'rss'],
      );
      if (r.rows[0]?.inserted) inserted++;
      else updated++;
    }
    return { inserted, updated };
  });
}

async function main() {
  const cfg = loadConfig();
  const file = process.argv[2] ?? cfg.sourcesFile;
  const specs = validateSources(JSON.parse(readFileSync(file, 'utf8')));
  const db = createPool(cfg.databaseUrl, 2);
  try {
    const r = await seedSources(db, specs);
    log.info('sources seeded', { file, total: specs.length, ...r });
  } finally {
    await db.end();
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    log.error('seed failed', { err });
    process.exit(1);
  });
}
