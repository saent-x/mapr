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

  it('uses its own admin shell with sidebar sections', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.match(content, /admin-shell-page/, 'Admin must render its own full-page shell');
    assert.match(content, /admin-sidebar/, 'Admin must have its own sidebar');
    assert.match(content, /BrandMark/, 'Admin sidebar should use the same MAPR mark as the main sidebar');
    assert.match(content, /adminNavItems/, 'Admin sidebar must be driven by section nav items');
    assert.match(content, /activeSection === 'overview'/, 'Admin overview must be a sidebar section');
    assert.match(content, /activeSection === 'manage'/, 'Admin source management must be a sidebar section');
    assert.match(content, /activeSection === 'features'/, 'Admin feature access must be a sidebar section');
    assert.doesNotMatch(content, /id:\s*'pipeline'/, 'Pipeline should be merged into overview, not remain a separate sidebar page');
  });

  it('has admin controls for feature access tiers', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.match(content, /FEATURE_ACCESS_CATALOG/, 'Admin should render the shared feature catalog');
    assert.match(content, /\/api\/admin\/feature-flags/, 'Admin should persist feature flags through the admin API');
    assert.match(content, /FEATURE_TIER_FREE/, 'Admin should support free-user access');
    assert.match(content, /FEATURE_TIER_PRO/, 'Admin should support Pro-only access');
    assert.match(content, /FEATURE_TIER_DISABLED/, 'Admin should support disabling a feature');
  });

  it('validates feature-flag API responses before rendering or saving admin controls', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.match(content, /readAdminJson/, 'Admin should use a strict JSON helper for admin APIs');
    assert.doesNotMatch(
      content,
      /readJsonIfOk\(featureFlagsRes\)/,
      'Feature flags must not silently fall back when the admin API returns HTML or 401'
    );
    assert.match(
      content,
      /const flags = await readAdminJson\(featureFlagsRes,\s*['"]Feature access['"]\)/,
      'Initial feature-flag load should fail loudly when the admin API is unavailable'
    );
    assert.match(
      content,
      /const saved = normalizeFeatureFlags\(await readAdminJson\(res,\s*['"]Feature access['"]\)\)/,
      'Feature-flag saves should validate the JSON response before updating state'
    );
  });

  it('paginates dense admin tables', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.match(content, /ADMIN_PAGE_SIZE\s*=\s*12/, 'Admin tables should show 12 rows per page');
    assert.match(content, /AdminPagination/, 'Admin must render pagination controls');
    assert.match(content, /paginatedFilteredFeeds\.map/, 'Source health table must use paginated rows');
    assert.match(content, /paginatedManageFeeds\.map/, 'Source management table must use paginated rows');
    assert.match(content, /paginatedReliabilityData\.map/, 'Reliability table must use paginated rows');
  });

  it('uses modals for source add, import, and export actions', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.match(content, /admin-modal-backdrop/, 'Admin source actions should render modal backdrops');
    assert.match(content, /role="dialog"/, 'Admin source modals should expose dialog semantics');
    assert.match(content, /showExport/, 'Admin export action should use a confirmation modal state');
    assert.match(content, /setShowAddForm\(true\)/, 'Add source button should open a modal');
    assert.match(content, /setShowImport\(true\)/, 'Import button should open a modal');
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
    assert.ok(en.admin.featureAccess, 'admin.featureAccess must exist');
  });

  it('all locales have the admin pagination label', () => {
    for (const locale of ['en', 'es', 'fr', 'ar', 'zh']) {
      const localePath = join(SRC, 'i18n', 'locales', `${locale}.json`);
      const messages = JSON.parse(readFileSync(localePath, 'utf8'));
      assert.ok(
        messages.admin?.showingRows,
        `${locale}.json should define admin.showingRows so table footers never render the raw i18n key`,
      );
    }
  });
});
