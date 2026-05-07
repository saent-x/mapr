/**
 * briefingExport.test.js — tests for briefing export feature (markdown + PDF utilities).
 *
 * Verifies:
 *  - VAL-M5-005: Both export formats include timestamp and active filters
 *  - VAL-M5-006: Briefing respects filtered state
 *  - briefingMarkdown generates correct output
 *  - briefingPdf utility exists and exports correctly
 *  - Export modal component exists
 *  - Generate Briefing buttons exist in FilterDrawer and NewsPanel
 *  - i18n export keys exist in all 5 locale files
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'src');

function readFile(relativePath) {
  return fs.readFileSync(path.join(ROOT, relativePath), 'utf-8');
}

function fileExists(relativePath) {
  return fs.existsSync(path.join(ROOT, relativePath));
}

// ── File existence ──

test('briefingMarkdown.js exists', () => {
  assert.ok(fileExists('src/utils/briefingMarkdown.js'));
});

test('briefingPdf.js exists', () => {
  assert.ok(fileExists('src/utils/briefingPdf.js'));
});

test('BriefingExportModal component exists', () => {
  assert.ok(fileExists('src/components/BriefingExportModal.jsx'));
});

// ── briefingMarkdown utility ──

test('generateBriefingMarkdown produces non-empty string with events', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const events = [
    { id: '1', title: 'Test Event', severity: 85, region: 'Test', isoA2: 'US', articleCount: 3, entities: [{ name: 'NATO', type: 'ORG' }] },
  ];
  const md = generateBriefingMarkdown(events, { minSeverity: 60 });
  assert.ok(typeof md === 'string');
  assert.ok(md.length > 0);
});

test('generateBriefingMarkdown includes ISO-8601 timestamp', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const md = generateBriefingMarkdown([], {});
  // ISO-8601 in the generated line: e.g., 2026-05-07T12:34:56.789Z
  assert.ok(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(md), 'Should contain ISO-8601 timestamp');
});

test('generateBriefingMarkdown includes severity summary with all tiers', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const events = [
    { id: '1', title: 'Critical', severity: 90, articleCount: 1 },
    { id: '2', title: 'Low', severity: 10, articleCount: 1 },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('| CRITICAL | 1 |'));
  assert.ok(md.includes('| LOW | 1 |'));
});

// ── VAL-M5-005: Timestamp and active filters ──

test('VAL-M5-005: briefing markdown includes timestamp and active filter summary', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const filters = { dateWindow: '24h', minSeverity: 50, verificationFilter: 'verified' };
  const md = generateBriefingMarkdown([{ id: '1', title: 'Test', severity: 80, articleCount: 2 }], filters);
  // ISO-8601 timestamp
  assert.ok(/Generated.*\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(md), 'Should contain ISO timestamp');
  // Active filter summary
  assert.ok(md.includes('Active Filters'), 'Should include active filters header');
  assert.ok(md.includes('Time window: 24h'), 'Should include dateWindow filter');
  assert.ok(md.includes('Min severity: 50'), 'Should include minSeverity filter');
  assert.ok(md.includes('Verification: verified'), 'Should include verification filter');
});

// ── VAL-M5-006: Briefing respects filtered state ──

test('VAL-M5-006: briefing respects filtered state — severity counts differ per filter', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const events = [
    { id: '1', title: 'High', severity: 85, articleCount: 2 },
    { id: '2', title: 'Mid', severity: 50, articleCount: 1 },
    { id: '3', title: 'Low', severity: 10, articleCount: 1 },
  ];

  // Note: generateBriefingMarkdown receives events already filtered by the caller.
  // We test that passing different subsets produces different output.
  const mdAll = generateBriefingMarkdown(events, {});
  const mdFiltered = generateBriefingMarkdown(events.filter(e => (e.severity || 0) >= 60), { minSeverity: 60 });

  assert.ok(mdAll.includes('| CRITICAL | 1 |'));
  assert.ok(mdAll.includes('| LOW | 1 |'));
  // Filtered version should have different counts
  assert.notStrictEqual(mdAll, mdFiltered, 'Filtered and unfiltered markdown should differ');
  // events >= 60 severity are: id 1 (85) → 1 event
  assert.ok(mdFiltered.includes('**Events:** 1') || mdFiltered.includes('Events: 1'), 'Filtered should have 1 event');
});

test('VAL-M5-006: briefing markdown reflects entity filter', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const filters = { entityFilter: { name: 'NATO' }, minSeverity: 0 };
  const md = generateBriefingMarkdown([], filters);
  assert.ok(md.includes('Entity: NATO'), 'Should include entity filter in summary');
});

// ── Entity mentions ──

test('briefing markdown includes entity mentions section', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const events = [
    { id: '1', title: 'Event 1', severity: 70, entities: [{ name: 'NATO', type: 'ORG' }, { name: 'Ukraine', type: 'LOC' }] },
    { id: '2', title: 'Event 2', severity: 50, entities: [{ name: 'NATO', type: 'ORG' }] },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('## Entity Mentions'), 'Should have entity mentions section');
  assert.ok(md.includes('NATO'));
  assert.ok(md.includes('Ukraine'));
  assert.ok(md.includes('ORG'));
  assert.ok(md.includes('LOC'));
});

test('briefing markdown shows no entities message when none found', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const md = generateBriefingMarkdown([], {});
  assert.ok(md.includes('No named entities found') || md.includes('Entity Mentions'));
});

// ── Coverage stats ──

test('briefing markdown includes coverage stats section', async () => {
  const { generateBriefingMarkdown } = await import('../src/utils/briefingMarkdown.js');
  const events = [
    { id: '1', title: 'A', severity: 50, isoA2: 'US', articleCount: 3 },
    { id: '2', title: 'B', severity: 40, isoA2: 'UA', articleCount: 2 },
  ];
  const md = generateBriefingMarkdown(events, {});
  assert.ok(md.includes('## Coverage Stats'), 'Should have coverage stats section');
  assert.ok(md.includes('Regions covered'));
  assert.ok(md.includes('Total source articles'));
});

// ── PDF utility ──

test('briefingPdf exports generateBriefingPdf function', async () => {
  const mod = await import('../src/utils/briefingPdf.js');
  assert.ok(typeof mod.generateBriefingPdf === 'function');
});

// ── Component existence ──

test('BriefingExportModal imports useTranslation and lucide icons', () => {
  const src = readFile('src/components/BriefingExportModal.jsx');
  assert.ok(src.includes('useTranslation'), 'Should use i18n');
  assert.ok(src.includes('lucide-react'), 'Should use lucide icons');
  assert.ok(src.includes('generateBriefingMarkdown'), 'Should import markdown generator');
  assert.ok(src.includes('generateBriefingPdf'), 'Should import PDF generator');
  assert.ok(src.includes('Copy'), 'Should have clipboard action');
  assert.ok(src.includes('FileDown'), 'Should have PDF action');
});

test('Generate Briefing button exists in FilterDrawer', () => {
  const src = readFile('src/components/FilterDrawer.jsx');
  assert.ok(src.includes('generateBriefing'), 'FilterDrawer should have Generate Briefing button');
  assert.ok(src.includes('setShowExport'), 'FilterDrawer should call setShowExport');
});

test('Generate Briefing button exists in NewsPanel', () => {
  const src = readFile('src/components/NewsPanel.jsx');
  assert.ok(src.includes("t('export.generateBriefing'"), 'NewsPanel should use t(\'export.generateBriefing\') for button text');
  assert.ok(src.includes('setShowExport'), 'NewsPanel should call setShowExport');
});

// ── i18n keys in all 5 locale files ──

const LOCALES = ['en', 'es', 'fr', 'ar', 'zh'];

for (const locale of LOCALES) {
  test(`export i18n keys exist in ${locale}.json`, () => {
    const raw = readFile(`src/i18n/locales/${locale}.json`);
    const json = JSON.parse(raw);
    assert.ok(json.export, `${locale}.json should have export section`);
    assert.ok(json.export.generateBriefing, `${locale}.json should have export.generateBriefing`);
    assert.ok(json.export.copyClipboard, `${locale}.json should have export.copyClipboard`);
    assert.ok(json.export.exportPdf, `${locale}.json should have export.exportPdf`);
    assert.ok(json.export.clipboardSuccess, `${locale}.json should have export.clipboardSuccess`);
    assert.ok(json.export.pdfSuccess, `${locale}.json should have export.pdfSuccess`);
    assert.ok(json.export.title, `${locale}.json should have export.title`);
    assert.ok(json.export.close, `${locale}.json should have export.close`);
    assert.ok(json.export.severitySummary, `${locale}.json should have export.severitySummary`);
    assert.ok(json.export.entityMentions, `${locale}.json should have export.entityMentions`);
    assert.ok(json.export.coverageStats, `${locale}.json should have export.coverageStats`);
  });
}

// ── uiStore has showExport ──

test('uiStore has showExport state and setter', async () => {
  const mod = await import('../src/stores/uiStore.js');
  const store = mod.default;
  const state = store.getState();
  assert.ok('showExport' in state, 'uiStore should have showExport state');
  assert.strictEqual(state.showExport, false, 'showExport should default to false');
  assert.ok(typeof state.setShowExport === 'function', 'uiStore should have setShowExport action');
});

// ── html2canvas and jspdf installed ──

test('html2canvas is in package.json dependencies', () => {
  const pkg = JSON.parse(readFile('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps.html2canvas || deps['html2canvas'], 'html2canvas should be installed');
});

test('jspdf is in package.json dependencies', () => {
  const pkg = JSON.parse(readFile('package.json'));
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  assert.ok(deps.jspdf || deps['jspdf'], 'jspdf should be installed');
});

// ── CSS has export modal styles ──

test('export modal styles exist in index.css', () => {
  const css = readFile('src/index.css');
  assert.ok(css.includes('export-modal-backdrop'), 'CSS should have export-modal-backdrop');
  assert.ok(css.includes('export-modal'), 'CSS should have export-modal');
  assert.ok(css.includes('export-actions'), 'CSS should have export-actions');
});

// ── App.jsx renders BriefingExportModal ──

test('App.jsx imports and renders BriefingExportModal', () => {
  const src = readFile('src/App.jsx');
  assert.ok(src.includes('BriefingExportModal'), 'App.jsx should import BriefingExportModal');
  assert.ok(src.includes('<BriefingExportModal'), 'App.jsx should render BriefingExportModal');
  assert.ok(src.includes('activeNews'), 'App.jsx should pass activeNews');
});
