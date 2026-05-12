import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  addSourceToCatalog,
  updateSourceInCatalog,
  removeSourceFromCatalog,
  importSourcesToCatalog,
  reEnableSourceInCatalog,
  autoDisableFailingSources,
} from '../server/sourceCatalog.js';
import {
  buildGdeltSearchUrl,
  buildSourceAddPayload,
} from '../src/utils/adminSourcePayload.js';

const SRC = join(import.meta.dirname, '..', 'src');

describe('Source Management CRUD helpers', () => {
  const baseCatalog = [
    { id: 'src-a', name: 'Source A', url: 'https://a.example/rss', enabled: true, fetchMode: 'rss', country: 'US' },
    { id: 'src-b', name: 'Source B', url: 'https://b.example/rss', enabled: true, fetchMode: 'rss', country: 'CA' },
    { id: 'src-c', name: 'Source C', url: 'https://c.example/rss', enabled: false, fetchMode: 'rss', country: 'UK' },
  ];

  describe('addSourceToCatalog', () => {
    it('adds a new source with auto-generated ID', () => {
      const result = addSourceToCatalog(baseCatalog, {
        name: 'New Source',
        url: 'https://new.example/rss',
        country: 'FR',
      });
      assert.equal(result.length, baseCatalog.length + 1);
      const added = result[result.length - 1];
      assert.ok(added.id.startsWith('custom-'));
      assert.equal(added.name, 'New Source');
      assert.equal(added.url, 'https://new.example/rss');
      assert.equal(added.country, 'FR');
    });

    it('uses provided ID when specified', () => {
      const result = addSourceToCatalog(baseCatalog, {
        id: 'my-custom-id',
        name: 'Custom ID Source',
        url: 'https://custom.example/rss',
      });
      const added = result.find((e) => e.id === 'my-custom-id');
      assert.ok(added);
      assert.equal(added.name, 'Custom ID Source');
    });

    it('normalizes the entry (adds sourceClass, cadenceMinutes, etc.)', () => {
      const result = addSourceToCatalog(baseCatalog, {
        name: 'Normalized Source',
        url: 'https://norm.example/rss',
        country: 'JP',
      });
      const added = result[result.length - 1];
      assert.ok(added.sourceClass);
      assert.ok(Number.isFinite(added.cadenceMinutes));
      assert.ok(added.priority !== undefined);
      assert.equal(added.fetchMode, 'rss');
    });

    it('preserves GDELT source contract fields after required-only UI payload', () => {
      const payload = buildSourceAddPayload({
        name: 'Ukraine Conflict Monitor',
        gdeltQuery: 'Ukraine AND conflict',
      }, 'gdelt');
      const result = addSourceToCatalog(baseCatalog, payload);
      const added = result[result.length - 1];

      assert.equal(added.name, 'Ukraine Conflict Monitor');
      assert.equal(added.fetchMode, 'gdelt');
      assert.equal(added.sourceType, 'gdelt');
      assert.equal(added.gdeltQuery, 'Ukraine AND conflict');
      assert.equal(added.url, buildGdeltSearchUrl('Ukraine AND conflict'));
    });
  });

  describe('updateSourceInCatalog', () => {
    it('updates an existing source', () => {
      const result = updateSourceInCatalog(baseCatalog, 'src-a', {
        name: 'Updated Source A',
        url: 'https://updated.example/rss',
      });
      const updated = result.find((e) => e.id === 'src-a');
      assert.equal(updated.name, 'Updated Source A');
      assert.equal(updated.url, 'https://updated.example/rss');
    });

    it('returns unchanged catalog for non-existent ID', () => {
      const result = updateSourceInCatalog(baseCatalog, 'nonexistent', { name: 'X' });
      assert.deepEqual(result, baseCatalog);
    });

    it('preserves other sources unchanged', () => {
      const result = updateSourceInCatalog(baseCatalog, 'src-a', { name: 'X' });
      const unchanged = result.find((e) => e.id === 'src-b');
      assert.equal(unchanged.name, 'Source B');
    });
  });

  describe('removeSourceFromCatalog', () => {
    it('removes an existing source', () => {
      const result = removeSourceFromCatalog(baseCatalog, 'src-a');
      assert.equal(result.length, baseCatalog.length - 1);
      assert.equal(result.find((e) => e.id === 'src-a'), undefined);
    });

    it('returns unchanged catalog for non-existent ID', () => {
      const result = removeSourceFromCatalog(baseCatalog, 'nonexistent');
      assert.deepEqual(result, baseCatalog);
    });
  });

  describe('importSourcesToCatalog', () => {
    it('adds new sources that do not exist', () => {
      const newFeeds = [
        { id: 'import-1', name: 'Import 1', url: 'https://i1.example/rss' },
        { id: 'import-2', name: 'Import 2', url: 'https://i2.example/rss' },
      ];
      const result = importSourcesToCatalog(baseCatalog, newFeeds);
      assert.equal(result.length, baseCatalog.length + 2);
      assert.ok(result.find((e) => e.id === 'import-1'));
      assert.ok(result.find((e) => e.id === 'import-2'));
    });

    it('skips sources with existing IDs', () => {
      const newFeeds = [
        { id: 'src-a', name: 'Duplicate A', url: 'https://dup.example/rss' },
        { id: 'import-3', name: 'Import 3', url: 'https://i3.example/rss' },
      ];
      const result = importSourcesToCatalog(baseCatalog, newFeeds);
      assert.equal(result.length, baseCatalog.length + 1);
      const dup = result.find((e) => e.id === 'src-a');
      assert.equal(dup.name, 'Source A'); // original preserved
    });

    it('skips sources without IDs', () => {
      const newFeeds = [
        { name: 'No ID', url: 'https://noid.example/rss' },
        { id: 'import-4', name: 'Import 4', url: 'https://i4.example/rss' },
      ];
      const result = importSourcesToCatalog(baseCatalog, newFeeds);
      assert.equal(result.length, baseCatalog.length + 1);
    });
  });

  describe('reEnableSourceInCatalog', () => {
    it('re-enables a disabled source', () => {
      const result = reEnableSourceInCatalog(baseCatalog, 'src-c');
      const reEnabled = result.find((e) => e.id === 'src-c');
      assert.equal(reEnabled.enabled, true);
    });

    it('does not affect already-enabled sources', () => {
      const result = reEnableSourceInCatalog(baseCatalog, 'src-a');
      const src = result.find((e) => e.id === 'src-a');
      assert.equal(src.enabled, true);
    });
  });

  describe('autoDisableFailingSources', () => {
    it('auto-disables sources with 3+ consecutive failures', () => {
      const catalog = [
        { id: 'fail-1', name: 'Failing 1', url: 'https://f1.example/rss', enabled: true, fetchMode: 'rss' },
        { id: 'fail-2', name: 'Failing 2', url: 'https://f2.example/rss', enabled: true, fetchMode: 'rss' },
        { id: 'ok-1', name: 'OK 1', url: 'https://ok1.example/rss', enabled: true, fetchMode: 'rss' },
      ];
      const sourceState = {
        'fail-1': { consecutiveFailures: 5, lastStatus: 'failed' },
        'fail-2': { consecutiveFailures: 3, lastStatus: 'failed' },
        'ok-1': { consecutiveFailures: 1, lastStatus: 'ok' },
      };
      const { catalog: updated, disabled } = autoDisableFailingSources(catalog, sourceState);
      assert.equal(disabled.length, 2);
      assert.ok(disabled.includes('fail-1'));
      assert.ok(disabled.includes('fail-2'));
      const f1 = updated.find((e) => e.id === 'fail-1');
      assert.equal(f1.enabled, false);
      assert.equal(f1.autoDisabled, true);
      const ok1 = updated.find((e) => e.id === 'ok-1');
      assert.equal(ok1.enabled, true);
    });

    it('does not disable sources with < 3 failures', () => {
      const catalog = [
        { id: 'few-fail', name: 'Few Fails', url: 'https://ff.example/rss', enabled: true, fetchMode: 'rss' },
      ];
      const sourceState = { 'few-fail': { consecutiveFailures: 2, lastStatus: 'failed' } };
      const { catalog: updated, disabled } = autoDisableFailingSources(catalog, sourceState);
      assert.equal(disabled.length, 0);
      const src = updated.find((e) => e.id === 'few-fail');
      assert.equal(src.enabled, true);
    });

    it('skips already-disabled sources', () => {
      const catalog = [
        { id: 'already-off', name: 'Already Off', url: 'https://ao.example/rss', enabled: false, fetchMode: 'rss' },
      ];
      const sourceState = { 'already-off': { consecutiveFailures: 5, lastStatus: 'failed' } };
      const { catalog: updated, disabled } = autoDisableFailingSources(catalog, sourceState);
      assert.equal(disabled.length, 0); // already disabled, not re-disabled
    });
  });
});

describe('Admin source add payload contract', () => {
  it('builds RSS payload with the server required name and url fields', () => {
    const payload = buildSourceAddPayload({
      name: 'Reuters World',
      url: 'https://www.reutersagency.com/feed/',
      country: 'United Kingdom',
      sourceType: 'wire',
      notes: 'Wire feed',
    }, 'rss');

    assert.deepEqual(payload, {
      name: 'Reuters World',
      url: 'https://www.reutersagency.com/feed/',
      country: 'United Kingdom',
      sourceType: 'wire',
      fetchMode: 'rss',
      notes: 'Wire feed',
    });
  });

  it('builds GDELT payload with generated url when the required-only form omits URL', () => {
    const payload = buildSourceAddPayload({
      name: 'GDELT Required Only',
      gdeltQuery: 'sourcecountry:UK protest',
    }, 'gdelt');

    assert.equal(payload.name, 'GDELT Required Only');
    assert.equal(payload.fetchMode, 'gdelt');
    assert.equal(payload.sourceType, 'gdelt');
    assert.equal(payload.gdeltQuery, 'sourcecountry:UK protest');
    assert.equal(payload.url, buildGdeltSearchUrl('sourcecountry:UK protest'));
    assert.ok(payload.url.includes('api.gdeltproject.org/api/v2/doc/doc'));
    assert.ok(payload.url.includes('query=sourcecountry%3AUK+protest'));
  });
});

describe('AdminPage source management UI (structural)', () => {
  const pagePath = join(SRC, 'pages', 'AdminPage.jsx');

  it('AdminPage.jsx includes source management UI elements', () => {
    assert.ok(existsSync(pagePath), 'AdminPage.jsx must exist');
    const content = readFileSync(pagePath, 'utf8');

    // Source management section
    assert.ok(content.includes('sourceManagement'), 'Must include source management section');

    // Add source form
    assert.ok(content.includes('addSource'), 'Must include add source functionality');
    assert.ok(content.includes('showAddForm'), 'Must have add form toggle state');
    assert.ok(content.includes('addFormType'), 'Must support RSS/GDELT form type switching');

    // CRUD operations
    assert.ok(content.includes('/api/source-catalog/add'), 'Must POST to add endpoint');
    assert.ok(content.includes('/api/source-catalog/'), 'Must reference source catalog API path');
    assert.ok(content.includes('handleDeleteSource'), 'Must have delete handler');
    assert.ok(content.includes('handleEditClick'), 'Must have edit handler');
    assert.ok(content.includes('handleReEnable'), 'Must have re-enable handler');

    // Bulk import/export
    assert.ok(content.includes('importSources'), 'Must include import functionality');
    assert.ok(content.includes('handleImportJson'), 'Must have JSON import handler');
    assert.ok(content.includes('exportSources'), 'Must include export functionality');
    assert.ok(content.includes('handleExport'), 'Must have export handler');

    // Source health / auto-disable
    assert.ok(content.includes('autoDisabled'), 'Must reference auto-disabled state');
    assert.ok(content.includes('reEnable'), 'Must have re-enable capability');

    // Auth: uses credentials: 'include' for admin session
    assert.ok(content.includes("credentials: 'include'"), 'Must send admin session cookies');
  });

  it('Source management section uses i18n keys', () => {
    const content = readFileSync(pagePath, 'utf8');
    assert.ok(content.includes("t('admin.sourceManagement')"), 'Must use sourceManagement i18n key');
    assert.ok(content.includes("t('admin.addSource')"), 'Must use addSource i18n key');
    assert.ok(content.includes("t('admin.editSource')"), 'Must use editSource i18n key');
    assert.ok(content.includes("t('admin.deleteSource')"), 'Must use deleteSource i18n key');
    assert.ok(content.includes("t('admin.importSources')"), 'Must use importSources i18n key');
    assert.ok(content.includes("t('admin.exportSources')"), 'Must use exportSources i18n key');
  });
});

describe('Admin source management i18n keys', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];

  for (const locale of locales) {
    it(`${locale}.json has all required source management keys`, () => {
      const path = join(SRC, 'i18n', 'locales', `${locale}.json`);
      const data = JSON.parse(readFileSync(path, 'utf8'));
      const admin = data.admin || {};

      const requiredKeys = [
        'sourceManagement', 'sourceManagementDesc', 'addSource', 'importSources', 'exportSources',
        'addNewSource', 'editSource', 'deleteSource', 'saveSource', 'cancel',
        'rssFeed', 'gdeltQuery', 'sourceNameLabel', 'urlLabel', 'countryLabel',
        'sourceTypeLabel', 'notesLabel', 'autoDisabledLabel', 'autoDisabled', 'disabled',
        'active', 'reEnable', 'actions', 'sourceAdded', 'sourceUpdated', 'sourceDeleted',
        'sourceReEnabled', 'confirmDelete', 'importSourcesTitle', 'pasteJson', 'uploadFile',
        'pasteJsonPlaceholder', 'importSubmit', 'importSuccess', 'invalidJson',
        'invalidJsonFile', 'importEmptyArray', 'noFileSelected', 'changeFile',
        'exportSuccess', 'searchSourcesManage', 'noSourcesFound', 'sourcesTotal',
      ];

      for (const key of requiredKeys) {
        assert.ok(admin[key] !== undefined && admin[key] !== '', `Missing or empty admin.${key} in ${locale}.json`);
      }
    });
  }
});
