import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');

test('saved views include premium analyst metadata and workflow controls', () => {
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  const hook = readFileSync(resolve(root, 'src/hooks/useSavedViews.js'), 'utf8');
  const dialog = readFileSync(resolve(root, 'src/components/SaveViewDialog.jsx'), 'utf8');
  const sidebar = readFileSync(resolve(root, 'src/components/SavedViewsSidebar.jsx'), 'utf8');

  assert.match(schema, /savedViews:\s*i\.entity\(\{[\s\S]*description:\s*i\.string\(\)\.optional\(\)/);
  assert.match(schema, /savedViews:\s*i\.entity\(\{[\s\S]*tags:\s*i\.json\(\)\.optional\(\)/);
  assert.match(schema, /savedViews:\s*i\.entity\(\{[\s\S]*pinned:\s*i\.boolean\(\)\.optional\(\)/);
  assert.match(schema, /savedViews:\s*i\.entity\(\{[\s\S]*lastOpenedAt:\s*i\.number\(\)\.optional\(\)/);

  assert.ok(hook.includes('updateView'), 'saved views should support metadata updates');
  assert.ok(hook.includes('duplicateView'), 'saved views should support duplication');
  assert.ok(hook.includes('.sort((a, b)'), 'saved views should be sorted by pinned and recency');
  assert.ok(dialog.includes('description') && dialog.includes('tagsInput') && dialog.includes('pinned'), 'save dialog should capture analyst metadata');
  assert.ok(sidebar.includes('handlePin') && sidebar.includes('handleDuplicate'), 'sidebar should expose pin and duplicate controls');
  assert.ok(sidebar.includes('saved-views-description') && sidebar.includes('saved-views-tags'), 'sidebar should display metadata');
});

test('alert rules include premium signal controls beyond a simple severity threshold', () => {
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  const hook = readFileSync(resolve(root, 'src/hooks/useAlertRules.js'), 'utf8');
  const dialog = readFileSync(resolve(root, 'src/components/AlertRuleDialog.jsx'), 'utf8');
  const panel = readFileSync(resolve(root, 'src/components/AlertRulesPanel.jsx'), 'utf8');

  assert.match(schema, /alertRules:\s*i\.entity\(\{[\s\S]*minConfidence:\s*i\.number\(\)\.optional\(\)/);
  assert.match(schema, /alertRules:\s*i\.entity\(\{[\s\S]*deliveryMode:\s*i\.string\(\)\.optional\(\)/);
  assert.match(schema, /alertRules:\s*i\.entity\(\{[\s\S]*quietHours:\s*i\.json\(\)\.optional\(\)/);
  assert.match(schema, /alertRules:\s*i\.entity\(\{[\s\S]*channels:\s*i\.json\(\)\.optional\(\)/);

  assert.ok(hook.includes('confidenceThreshold'), 'alert matching should include confidence thresholding');
  assert.ok(hook.includes('Math.max(filterParams.minConfidence'), 'alert threshold should respect both saved view and rule confidence');
  assert.ok(dialog.includes('deliveryMode'), 'dialog should configure delivery mode');
  assert.ok(dialog.includes('emailEnabled') && dialog.includes('digestEnabled') && dialog.includes('quietHoursEnabled'), 'dialog should configure channels and quiet hours');
  assert.ok(panel.includes('alert-rules-premium-meta'), 'panel should show premium delivery metadata');
});

test('bookmarks support analyst triage with status, priority, notes, and richer story context', () => {
  const schema = readFileSync(resolve(root, 'instant.schema.ts'), 'utf8');
  const hook = readFileSync(resolve(root, 'src/hooks/useBookmarks.js'), 'utf8');
  const panel = readFileSync(resolve(root, 'src/components/BookmarksPanel.jsx'), 'utf8');

  assert.match(schema, /bookmarks:\s*i\.entity\(\{[\s\S]*storySummary:\s*i\.string\(\)\.optional\(\)/);
  assert.match(schema, /bookmarks:\s*i\.entity\(\{[\s\S]*note:\s*i\.string\(\)\.optional\(\)/);
  assert.match(schema, /bookmarks:\s*i\.entity\(\{[\s\S]*status:\s*i\.string\(\)\.optional\(\)/);
  assert.match(schema, /bookmarks:\s*i\.entity\(\{[\s\S]*priority:\s*i\.string\(\)\.optional\(\)/);

  assert.ok(hook.includes('filterStatus') && hook.includes('filterPriority'), 'bookmarks should filter by workflow status and priority');
  assert.ok(hook.includes('updateBookmark'), 'bookmarks should be editable after capture');
  assert.ok(panel.includes('handleStatusToggle') && panel.includes('handlePriorityToggle'), 'bookmark panel should expose triage controls');
  assert.ok(panel.includes('bookmark-note-input'), 'bookmark panel should support analyst notes');
  assert.ok(panel.includes('bookmarks-item-summary'), 'bookmark panel should show captured story context');
});

test('premium workflow polish has dedicated CSS classes', () => {
  const css = readFileSync(resolve(root, 'src/index.css'), 'utf8');

  for (const selector of [
    '.saved-views-description',
    '.saved-views-tags',
    '.alert-rule-premium-grid',
    '.alert-rules-premium-meta',
    '.bookmark-status-chip',
    '.bookmark-priority-chip',
    '.bookmark-note-input',
    '.bookmark-workflow-actions',
  ]) {
    assert.ok(css.includes(selector), `${selector} should be styled`);
  }
});
