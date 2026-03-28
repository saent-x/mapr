import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const SRC = join(import.meta.dirname, '..', 'src');

describe('AdminPage dashboard', () => {
  const pagePath = join(SRC, 'pages', 'AdminPage.jsx');

  it('AdminPage.jsx exists and is not a placeholder', () => {
    assert.ok(existsSync(pagePath), 'AdminPage.jsx must exist');
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(!content.includes('placeholder-page'), 'AdminPage should not be a placeholder anymore');
    assert.ok(content.length > 2000, 'AdminPage should be a full implementation, not a stub');
  });

  it('fetches data from /api/source-catalog/state and /api/health', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(
      content.includes('/api/source-catalog/state') || content.includes('source-catalog/state'),
      'Must fetch from source-catalog/state endpoint',
    );
    assert.ok(
      content.includes('/api/health'),
      'Must fetch from health endpoint',
    );
  });

  it('displays source health table with required columns', () => {
    const content = readFileSync(pagePath, 'utf8');
    // Should reference status, last checked, article count, and source type
    assert.ok(content.includes('status') || content.includes('Status'), 'Must display status column');
    assert.ok(
      content.includes('lastCheckedAt') || content.includes('lastChecked') || content.includes('admin.lastChecked'),
      'Must display last checked time',
    );
    assert.ok(
      content.includes('articleCount') || content.includes('admin.articleCount'),
      'Must display article count',
    );
  });

  it('shows aggregate stats section with total/healthy/failed counts', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(
      content.includes('totalSources') || content.includes('admin.totalSources'),
      'Must show total sources count',
    );
  });

  it('shows ingestion health section', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(
      content.includes('lastAttemptAt') || content.includes('lastSuccessAt') || content.includes('admin.lastAttempt'),
      'Must show ingestion health info',
    );
    assert.ok(
      content.includes('consecutiveFailures') || content.includes('admin.consecutiveFailures'),
      'Must show consecutive failures',
    );
  });

  it('uses i18n for user-visible strings', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('useTranslation'), 'Must use useTranslation hook');
    assert.ok(content.includes("t('admin."), 'Must use t() with admin namespace keys');
  });

  it('uses lucide-react icons', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(content.includes('lucide-react'), 'Must import icons from lucide-react');
  });

  it('has auto-refresh capability', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(
      content.includes('setInterval') || content.includes('setTimeout') || content.includes('useEffect'),
      'Must have auto-refresh or periodic fetch',
    );
  });
});

describe('AdminPage i18n keys', () => {
  it('en.json has admin dashboard keys', () => {
    const enPath = join(SRC, 'i18n', 'locales', 'en.json');
    const en = JSON.parse(readFileSync(enPath, 'utf8'));
    assert.ok(en.admin, 'admin namespace must exist');
    assert.ok(en.admin.title, 'admin.title must exist');
    assert.ok(en.admin.sourceHealth, 'admin.sourceHealth must exist');
    assert.ok(en.admin.ingestionHealth, 'admin.ingestionHealth must exist');
    assert.ok(en.admin.aggregateStats, 'admin.aggregateStats must exist');
  });
});
