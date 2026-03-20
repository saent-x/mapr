import test from 'node:test';
import assert from 'node:assert/strict';
import { getRegionBackfillFeedPlan } from '../server/ingest.js';

test('getRegionBackfillFeedPlan includes local, official, and global feeds', () => {
  const plan = getRegionBackfillFeedPlan('Nigeria');
  const ids = plan.map((feed) => feed.id);
  const hasGlobalFeed = ids.some((id) => ['bbc', 'aljazeera', 'guardian-uk', 'dw', 'france24', 'euronews', 'npr'].includes(id));

  assert(ids.includes('punch-ng'));
  assert(ids.includes('premiumtimes-ng'));
  assert(ids.includes('un-news'));
  assert.equal(hasGlobalFeed, true);
  assert.equal(new Set(ids).size, ids.length);
});

test('getRegionBackfillFeedPlan includes targeted regional feeds when a country has no direct local catalog', () => {
  const plan = getRegionBackfillFeedPlan('Georgia');
  const ids = plan.map((feed) => feed.id);

  assert(ids.includes('ocmedia'));
  assert(ids.includes('un-news'));
  assert(ids.includes('guardian-uk'));
  assert.equal(new Set(ids).size, ids.length);
});
