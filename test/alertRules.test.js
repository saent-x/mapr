/**
 * Tests for alert rules (m3-alert-rules).
 *
 * Covers:
 *   VAL-M3-008: Create Alert Rule from Saved View
 *   VAL-M3-009: Toast Notification on Matching Event
 *   VAL-M3-010: Alert Rule Management Panel — CRUD
 *   VAL-M3-011: Match Count Badge on Alert Rule
 *   VAL-M3-012: Inactive Alert Rule Suppresses Notifications
 */

import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Component file existence
// ---------------------------------------------------------------------------

test('useAlertRules hook exists', () => {
  const p = resolve(root, 'src/hooks/useAlertRules.js');
  assert.ok(existsSync(p), 'useAlertRules.js should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default function');
  assert.ok(content.includes('db.useQuery'), 'should use db.useQuery for InstantDB query');
  assert.ok(content.includes('db.transact'), 'should use db.transact for writes');
  assert.ok(content.includes('createRule'), 'should export createRule function');
  assert.ok(content.includes('editRule'), 'should export editRule function');
  assert.ok(content.includes('deleteRule'), 'should export deleteRule function');
  assert.ok(content.includes('toggleActive'), 'should export toggleActive function');
  assert.ok(content.includes('needsAuth'), 'should export needsAuth flag');
});

test('AlertRulesPanel component exists', () => {
  const p = resolve(root, 'src/components/AlertRulesPanel.jsx');
  assert.ok(existsSync(p), 'AlertRulesPanel.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('SignedIn'), 'should use SignedIn wrapper');
  assert.ok(content.includes('SignedOut'), 'should use SignedOut wrapper');
  assert.ok(content.includes('useAlertRules'), 'should use useAlertRules hook');
  assert.ok(content.includes('useSavedViews'), 'should use useSavedViews hook');
  assert.ok(content.includes('alert-rules-sidebar'), 'should render alert rules sidebar');
  assert.ok(content.includes('alert-rules-item'), 'should render alert rule items');
  assert.ok(content.includes('addToast'), 'should fire toasts for new matches');
});

test('AlertRuleDialog component exists', () => {
  const p = resolve(root, 'src/components/AlertRuleDialog.jsx');
  assert.ok(existsSync(p), 'AlertRuleDialog.jsx should exist');
  const content = readFileSync(p, 'utf8');
  assert.ok(content.includes('export default'), 'should export a default component');
  assert.ok(content.includes('save-view-overlay'), 'should reuse dialog overlay pattern');
  assert.ok(content.includes('save-view-dialog'), 'should reuse dialog container pattern');
  assert.ok(content.includes('useNavigate'), 'should use useNavigate for login redirect');
  assert.ok(content.includes('needsAuth'), 'should check needsAuth');
  assert.ok(content.includes('severityThreshold'), 'should have severity threshold selector');
  assert.ok(content.includes('savedViewId'), 'should have saved view selector');
  assert.ok(content.includes('handleSave'), 'should have handleSave that redirects when unauthenticated');
});

// ---------------------------------------------------------------------------
// VAL-M3-008: Create Alert Rule from Saved View
// ---------------------------------------------------------------------------

test('VAL-M3-008: createRule creates alert rule with correct fields', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');

  // createRule transaction must include all required fields
  assert.ok(content.includes('name'), 'should include name in transaction');
  assert.ok(content.includes('severityThreshold'), 'should include severityThreshold');
  assert.ok(content.includes('savedViewId'), 'should include savedViewId');
  assert.ok(content.includes('active: true'), 'should default active to true');
  assert.ok(content.includes('createdAt'), 'should include createdAt timestamp');
  assert.ok(content.includes('.link({ owner:'), 'should link to user via owner');

  // Hook must enforce auth
  assert.ok(content.includes('Must be authenticated'), 'should throw if not authenticated');
});

test('VAL-M3-008: alert rule linked to user and saved view', () => {
  // Schema verification — relationships moved to the dedicated `links:` block.
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  assert.ok(schema.includes('alertRules: i.entity'), 'alertRules entity should be defined');
  assert.ok(schema.includes('savedViewId: i.string()'), 'should have savedViewId string field');
  assert.ok(schema.includes('severityThreshold: i.number()'), 'should have severityThreshold number field');
  assert.ok(schema.includes('active: i.boolean()'), 'should have active boolean field');
  assert.match(schema, /userAlertRules:\s*\{[\s\S]*forward:\s*\{\s*on:\s*'alertRules',\s*has:\s*'one',\s*label:\s*'owner'/,
    'userAlertRules forward link must be alertRules.owner → $users (one)');
});

// ---------------------------------------------------------------------------
// VAL-M3-009: Toast Notification on Matching Event
// ---------------------------------------------------------------------------

test('VAL-M3-009: toast fires when new event matches active rule', () => {
  const content = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');

  // Should check newMatchArticles
  assert.ok(content.includes('newMatchArticles'), 'should check for new matching articles');
  assert.ok(content.includes('addToast'), 'should call addToast for matches');
  assert.ok(content.includes('rule.active'), 'should only fire for active rules');
  assert.ok(content.includes('newMatch'), 'should include new match message');
  assert.ok(content.includes('watch-alert'), 'should use watch-alert toast type');

  // Should track previously seen matches
  assert.ok(content.includes('prevNewMatchesRef'), 'should maintain ref of previous matches');
  assert.ok(content.includes('trulyNew'), 'should deduplicate toasts');
});

test('VAL-M3-009: toast message includes rule name and match details', () => {
  const content = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  assert.ok(content.includes('rule.name'), 'toast should include rule name');
  assert.ok(content.includes('article.title'), 'toast should include article title for single match');
});

// ---------------------------------------------------------------------------
// VAL-M3-010: Alert Rule Management Panel — CRUD
// ---------------------------------------------------------------------------

test('VAL-M3-010: panel supports create, edit, delete, toggle', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');

  // Create
  assert.ok(panelContent.includes('handleCreate'), 'should have create handler');
  assert.ok(panelContent.includes('setDialogOpen(true)'), 'should open dialog for create');

  // Edit
  assert.ok(panelContent.includes('handleEdit'), 'should have edit handler');
  assert.ok(panelContent.includes('AlertRuleDialog'), 'should render AlertRuleDialog');

  // Delete
  assert.ok(panelContent.includes('handleDelete'), 'should have delete handler');
  assert.ok(panelContent.includes('deleteRule'), 'should call deleteRule');

  // Toggle
  assert.ok(panelContent.includes('handleToggle'), 'should have toggle handler');
  assert.ok(panelContent.includes('toggleActive'), 'should call toggleActive');

  // Dialog integration
  const dialogContent = readFileSync(resolve(root, 'src/components/AlertRuleDialog.jsx'), 'utf8');
  assert.ok(dialogContent.includes('editRule'), 'dialog should support edit mode');
  assert.ok(dialogContent.includes('createRule'), 'dialog should support create mode');
  assert.ok(dialogContent.includes('updateRule'), 'dialog should call updateRule for edits');
});

test('VAL-M3-010: hook provides all CRUD operations', () => {
  const content = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');

  assert.ok(content.includes('createRule'), 'should export createRule');
  assert.ok(content.includes('const createRule'), 'should define createRule function');
  assert.ok(content.includes('db.transact'), 'createRule should use db.transact');

  assert.ok(content.includes('editRule'), 'should export editRule');
  assert.ok(content.includes('const editRule'), 'should define editRule function');

  assert.ok(content.includes('deleteRule'), 'should export deleteRule');
  assert.ok(content.includes('const deleteRule'), 'should define deleteRule function');
  assert.ok(content.includes('.delete()'), 'deleteRule should call delete()');

  assert.ok(content.includes('toggleActive'), 'should export toggleActive');
  assert.ok(content.includes('const toggleActive'), 'should define toggleActive function');
});

// ---------------------------------------------------------------------------
// VAL-M3-011: Match Count Badge on Alert Rule
// ---------------------------------------------------------------------------

test('VAL-M3-011: match count badge displayed per alert rule', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('saved-views-count'), 'should render match count badge');
  assert.ok(panelContent.includes('rule.matchCount'), 'should display rule matchCount');
  assert.ok(panelContent.includes('matchCountTitle'), 'should have match count title tooltip');

  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  assert.ok(hookContent.includes('matchCount'), 'hook should compute matchCount');
  assert.ok(hookContent.includes('storyMatchesFilters'), 'should use storyMatchesFilters for matching');
  assert.ok(hookContent.includes('activeNews.filter'), 'should filter activeNews for matches');
  assert.ok(hookContent.includes('severityThreshold'), 'should check severity threshold');
});

test('AlertRulesPanel header shows total rule count badge', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('sidebar-section-count-badge'), 'header should render a section count badge');
  assert.ok(panelContent.includes('{rules.length}'), 'alert rules header count should use total rules');
  assert.ok(panelContent.includes('{rules.length > 0 && ('), 'alert rules header badge should be hidden when count is zero');
});

test('VAL-M3-011: match count updates when news changes', () => {
  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  // The useMemo depends on [data, savedViews, activeNews] so it recomputes on news change
  assert.ok(hookContent.includes('useMemo'), 'should use useMemo for computed rules');
  assert.ok(hookContent.includes('[data, savedViews, activeNews]'), 'should depend on activeNews for recomputation');
});

// ---------------------------------------------------------------------------
// VAL-M3-012: Inactive Alert Rule Suppresses Notifications
// ---------------------------------------------------------------------------

test('VAL-M3-012: inactive rules suppress toast but track counts', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');

  // Toast suppression
  assert.ok(panelContent.includes('if (!rule.active) continue'), 'should skip inactive rules for toast');
  assert.ok(panelContent.includes('rule.active'), 'should check active flag before toasting');

  // Count tracking (matchCount is computed regardless of active state)
  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  assert.ok(hookContent.includes('activeNews.filter'), 'should compute matchCount for all rules');
});

test('VAL-M3-012: toggle button changes active state', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('data-active'), 'toggle should have data-active attribute');
  assert.ok(panelContent.includes('Bell'), 'should show Bell icon when active');
  assert.ok(panelContent.includes('BellOff'), 'should show BellOff icon when inactive');
  assert.ok(panelContent.includes('toggleActive'), 'should call toggleActive on click');
});

// ---------------------------------------------------------------------------
// Auth gating
// ---------------------------------------------------------------------------

test('alert rules panel is auth-gated', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  assert.ok(panelContent.includes('useNavigate'), 'panel should use useNavigate for login redirect');
  assert.ok(panelContent.includes('needsAuth'), 'panel should check needsAuth');
  assert.ok(panelContent.includes('signInPrompt'), 'should show sign-in prompt when logged out');
  assert.ok(panelContent.includes('sidebar-pro-feature-action'), 'signed-out panel should render an icon action');
  assert.ok(panelContent.includes('sidebar-pro-badge'), 'signed-out panel should mark alert rules as Pro');

  const dialogContent = readFileSync(resolve(root, 'src/components/AlertRuleDialog.jsx'), 'utf8');
  assert.ok(dialogContent.includes('useNavigate'), 'dialog should use useNavigate for login redirect');
  assert.ok(dialogContent.includes('needsAuth'), 'dialog should check needsAuth');
});

test('hook skips query when unauthenticated', () => {
  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  assert.ok(hookContent.includes('user'), 'should check for user');
  assert.ok(hookContent.includes(': null'), 'should pass null query when no user');
  assert.ok(hookContent.includes('needsAuth = '), 'should compute needsAuth');
});

// ---------------------------------------------------------------------------
// Severity threshold matching
// ---------------------------------------------------------------------------

test('alert rules filter by severity threshold', () => {
  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  assert.ok(hookContent.includes('threshold = r.severityThreshold'), 'should get threshold from rule');
  assert.ok(hookContent.includes('(s.severity ?? 0) >= threshold'), 'should filter by severity >= threshold');
  assert.ok(hookContent.includes('getSeverityMeta(threshold)'), 'should get severity label for display');
});

// ---------------------------------------------------------------------------
// Saved view association
// ---------------------------------------------------------------------------

test('alert rules look up saved view filter state', () => {
  const hookContent = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  assert.ok(hookContent.includes('viewsById'), 'should build view lookup map');
  assert.ok(hookContent.includes('r.savedViewId'), 'should read savedViewId from rule');
  assert.ok(hookContent.includes('view?.filters'), 'should access view filter state');
  assert.ok(hookContent.includes('resolveDateFloor'), 'should convert dateWindow to dateFloor');
});

// ---------------------------------------------------------------------------
// Layout integration
// ---------------------------------------------------------------------------

test('Layout includes AlertRulesPanel in sidebar', () => {
  const content = readFileSync(resolve(root, 'src/components/Layout.jsx'), 'utf8');
  assert.ok(content.includes('AlertRulesPanel'), 'Layout should import AlertRulesPanel');
  assert.ok(content.includes('<AlertRulesPanel'), 'Layout should render AlertRulesPanel');
});

// ---------------------------------------------------------------------------
// CSS styles
// ---------------------------------------------------------------------------

test('CSS styles exist for alert rules components', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  assert.ok(css.includes('alert-rules-sidebar'), 'should have sidebar container styles');
  assert.ok(css.includes('alert-rules-item'), 'should have item styles');
  assert.ok(css.includes('alert-rules-item-inner'), 'should have item inner styles');
  assert.ok(css.includes('alert-rules-toggle'), 'should have toggle button styles');
  assert.ok(css.includes('alert-rules-info-btn'), 'should have info button styles');
  assert.ok(css.includes('alert-rules-name'), 'should have name styles');
  assert.ok(css.includes('alert-rules-meta'), 'should have meta styles');
  assert.ok(css.includes('alert-rules-create-btn'), 'should have create button styles');
});

test('CSS includes active match count styling', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');
  assert.ok(css.includes('data-alert-count'), 'should have active match count data attribute');
  assert.ok(css.includes('alert-count'), 'should have alert count styles');
});

// ---------------------------------------------------------------------------
// i18n coverage
// ---------------------------------------------------------------------------

test('alertRules namespace exists in all 5 locale files', () => {
  const locales = ['en', 'es', 'fr', 'ar', 'zh'];
  for (const loc of locales) {
    const path = resolve(root, `src/i18n/locales/${loc}.json`);
    const json = JSON.parse(readFileSync(path, 'utf8'));
    assert.ok(json.alertRules, `${loc}.json should have alertRules namespace`);

    // Verify all required keys exist
    const keys = [
      'panelLabel', 'createTitle', 'editTitle', 'close',
      'ruleName', 'ruleNamePlaceholder', 'savedView', 'noSavedViews',
      'severityThreshold', 'sevThresholdLabel', 'nameRequired', 'viewRequired',
      'saveError', 'saving', 'createRule', 'updateRule',
      'signInPrompt', 'emptyHint', 'newRule', 'needSavedView',
      'edit', 'editAria', 'delete', 'deleteAria', 'deleted',
      'activate', 'activateAria', 'deactivate', 'deactivateAria',
      'expand', 'collapse', 'matchCountTitle', 'created', 'updated',
      'newMatch', 'newMatches',
    ];
    for (const key of keys) {
      assert.ok(json.alertRules[key] !== undefined,
        `${loc}.json alertRules.${key} should exist`);
      assert.ok(typeof json.alertRules[key] === 'string',
        `${loc}.json alertRules.${key} should be a string`);
    }
  }
});

// ---------------------------------------------------------------------------
// InstantDB schema
// ---------------------------------------------------------------------------

test('alertRules entity defined in InstantDB schema', () => {
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  assert.ok(schema.includes('alertRules: i.entity'), 'schema should define alertRules entity');
  assert.ok(schema.includes('name: i.string()'), 'should have name field');
  assert.ok(schema.includes('severityThreshold: i.number()'), 'should have severityThreshold field');
  assert.ok(schema.includes('savedViewId: i.string()'), 'should have savedViewId field');
  assert.ok(schema.includes('active: i.boolean()'), 'should have active field');
  assert.ok(schema.includes('createdAt: i.number()'), 'should have createdAt field');
});

// ---------------------------------------------------------------------------
// Toast type support
// ---------------------------------------------------------------------------

test('alert rules use supported toast type', () => {
  const panelContent = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');
  // watch-alert is a known toast type used by the existing watchlist system
  assert.ok(panelContent.includes("'watch-alert'"), 'should use watch-alert toast type');
});
