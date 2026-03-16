import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeStoryLists } from '../src/utils/aiState.js';

test('mergeStoryLists keeps the first copy of each story id', () => {
  const merged = mergeStoryLists(
    [{ id: 'story-a', title: 'A' }, { id: 'story-b', title: 'B' }],
    [{ id: 'story-b', title: 'B duplicate' }, { id: 'story-c', title: 'C' }]
  );

  assert.deepEqual(merged.map((story) => story.id), ['story-a', 'story-b', 'story-c']);
  assert.equal(merged[1].title, 'B');
});
