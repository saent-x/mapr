import test from 'node:test';
import assert from 'node:assert/strict';
import { buildRegionSourcePlan, buildSourceCoverageAudit } from '../src/utils/sourceCoverage.js';

test('buildSourceCoverageAudit highlights countries with no or thin local feeds', () => {
  const audit = buildSourceCoverageAudit({
    byIso: {
      NG: { status: 'developing', eventCount: 3 },
      OM: { status: 'uncovered', eventCount: 0 }
    }
  });

  assert(audit.stats.countriesWithoutLocalFeeds > 0);
  assert(audit.expansionTargets.some((entry) => entry.iso === 'OM'));
  assert(audit.byIso.NG.localFeedCount >= 1);
});

test('buildRegionSourcePlan returns local and planned feeds for a region', () => {
  const plan = buildRegionSourcePlan('Nigeria', { limit: 6 });

  assert.equal(plan.region, 'Nigeria');
  assert.equal(plan.iso, 'NG');
  assert(plan.localFeedCount >= 1);
  assert(plan.plannedFeedCount > 0);
  assert(plan.plannedFeeds.some((feed) => feed.id === 'punch-ng'));
});

test('buildRegionSourcePlan includes regional fallback feeds for countries without direct local feeds', () => {
  const plan = buildRegionSourcePlan('Georgia', { limit: 8 });

  assert.equal(plan.region, 'Georgia');
  assert.equal(plan.iso, 'GE');
  assert.equal(plan.localFeedCount, 0);
  assert(plan.regionalFeedCount >= 1);
  assert(plan.plannedFeeds.some((feed) => feed.id === 'ocmedia'));
});

test('buildSourceCoverageAudit tracks regional fallback coverage separately from local feeds', () => {
  const audit = buildSourceCoverageAudit({
    byIso: {
      GE: { status: 'uncovered', eventCount: 0 }
    }
  });

  assert.equal(audit.byIso.GE.localFeedCount, 0);
  assert(audit.byIso.GE.regionalFeedCount >= 1);
  assert(audit.byIso.GE.targetedFeedCount >= 1);
  assert(audit.stats.countriesWithRegionalFeeds > 0);
});

test('buildRegionSourcePlan keeps candidate-only sources out of the active feed counts', () => {
  const plan = buildRegionSourcePlan('Burundi', {
    limit: 8,
    feeds: [
      { id: 'candidate-bi', name: 'Iwacu', country: 'Burundi', fetchMode: 'html', enabled: false, notes: 'candidate source' },
      { id: 'global-a', name: 'Global A', sourceType: 'global', fetchMode: 'rss', enabled: true }
    ]
  });

  assert.equal(plan.localFeedCount, 0);
  assert.equal(plan.candidateLocalFeedCount, 1);
  assert(plan.candidateFeeds.some((feed) => feed.id === 'candidate-bi'));
});
