// Quick diagnostic: test DB connection and upsert behavior
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// Load .env
try {
  const envFile = readFileSync(resolve(root, '.env'), 'utf-8');
  for (const line of envFile.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let value = trimmed.slice(eqIdx + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !process.env[key]) process.env[key] = value;
  }
} catch { /* no .env file */ }

import pg from 'pg';
const { Pool } = pg;

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error('No DATABASE_URL');
  process.exit(1);
}

const cleanUrl = connectionString.replace(/[&?]channel_binding=[^&]*/g, '');
const pool = new Pool({
  connectionString: cleanUrl,
  ssl: { rejectUnauthorized: false },
  max: 2,
  idleTimeoutMillis: 10000
});

async function run() {
  console.log('1. Testing DB connection...');
  const { rows: [ver] } = await pool.query('SELECT version()');
  console.log('   PostgreSQL:', ver.version.slice(0, 50));

  console.log('2. Checking articles table schema...');
  const { rows: cols } = await pool.query(`
    SELECT column_name, data_type, is_nullable 
    FROM information_schema.columns 
    WHERE table_name = 'articles' 
    ORDER BY ordinal_position
  `);
  console.log('   Columns:', cols.map(c => `${c.column_name}(${c.data_type})`).join(', '));

  console.log('3. Checking constraints on articles table...');
  const { rows: constraints } = await pool.query(`
    SELECT c.conname, c.contype, a.attname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attnum = ANY(c.conkey) AND a.attrelid = c.conrelid
    WHERE c.conrelid = 'articles'::regclass
    ORDER BY c.conname, a.attnum
  `);
  const grouped = {};
  for (const row of constraints) {
    if (!grouped[row.conname]) grouped[row.conname] = { type: row.contype, cols: [] };
    grouped[row.conname].cols.push(row.attname);
  }
  for (const [name, info] of Object.entries(grouped)) {
    const type = { p: 'PRIMARY KEY', u: 'UNIQUE', f: 'FOREIGN KEY', c: 'CHECK' }[info.type] || info.type;
    console.log(`   ${name}: ${type} on (${info.cols.join(', ')})`);
  }

  console.log('4. Checking article count...');
  const { rows: [countResult] } = await pool.query('SELECT count(*) FROM articles');
  console.log('   Article count:', countResult.count);

  console.log('5. Testing upsert with ON CONFLICT (id)...');
  const testId = '__db_test_' + Date.now();
  try {
    await pool.query(`
      INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        source = EXCLUDED.source,
        "publishedAt" = EXCLUDED."publishedAt",
        "isoA2" = EXCLUDED."isoA2",
        severity = EXCLUDED.severity,
        "geocodePrecision" = EXCLUDED."geocodePrecision",
        payload = EXCLUDED.payload
    `, [testId, 'Test Article', 'https://test.example.com/' + testId, 'test', new Date().toISOString(), 'US', 50, 'exact', JSON.stringify({ id: testId, title: 'Test Article' })]);
    console.log('   INSERT 1: OK');

    // Re-insert same id (should upsert)
    await pool.query(`
      INSERT INTO articles (id, title, url, source, "publishedAt", "isoA2", severity, "geocodePrecision", payload)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        url = EXCLUDED.url,
        source = EXCLUDED.source,
        "publishedAt" = EXCLUDED."publishedAt",
        "isoA2" = EXCLUDED."isoA2",
        severity = EXCLUDED.severity,
        "geocodePrecision" = EXCLUDED."geocodePrecision",
        payload = EXCLUDED.payload
    `, [testId, 'Test Article Updated', 'https://test.example.com/' + testId + '-v2', 'test', new Date().toISOString(), 'US', 60, 'exact', JSON.stringify({ id: testId, title: 'Test Article Updated' })]);
    console.log('   INSERT 2 (re-upsert): OK');

    // Cleanup
    await pool.query('DELETE FROM articles WHERE id = $1', [testId]);
    console.log('   Cleanup: OK');
  } catch (err) {
    console.error('   UPSERT FAILED:', err.message);
    console.error('   Error code:', err.code);
    console.error('   Constraint:', err.constraint);
    // Cleanup
    await pool.query('DELETE FROM articles WHERE id = $1', [testId]).catch(() => {});
  }

  console.log('6. Checking events table...');
  const { rows: [eventCount] } = await pool.query('SELECT count(*) FROM events');
  console.log('   Event count:', eventCount.count);

  console.log('7. Checking event_articles table...');
  const { rows: [linkCount] } = await pool.query('SELECT count(*) FROM event_articles');
  console.log('   Link count:', linkCount.count);

  await pool.end();
  console.log('\nDone!');
}

run().catch(err => {
  console.error('FATAL:', err.message);
  pool.end().catch(() => {});
  process.exit(1);
});
