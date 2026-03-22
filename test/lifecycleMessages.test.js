import test from 'node:test';
import assert from 'node:assert/strict';
import { generateLifecycleMessages } from '../src/utils/lifecycleMessages.js';

test('generates messages for lifecycle transitions', () => {
  const current = [
    { id: 'evt-1', title: 'Turkey earthquake', lifecycle: 'escalating', severity: 85 },
    { id: 'evt-2', title: 'Mali conflict', lifecycle: 'developing', severity: 70 }
  ];
  const previous = [
    { id: 'evt-1', title: 'Turkey earthquake', lifecycle: 'developing', severity: 80 },
    { id: 'evt-2', title: 'Mali conflict', lifecycle: 'developing', severity: 70 }
  ];
  const messages = generateLifecycleMessages(current, previous);
  assert.equal(messages.length, 1);
  assert.ok(messages[0].text.includes('Turkey earthquake'));
  assert.ok(messages[0].text.includes('escalating'));
  assert.equal(messages[0].lifecycle, 'escalating');
});

test('returns empty array when no transitions', () => {
  const events = [{ id: 'evt-1', title: 'Test', lifecycle: 'developing', severity: 50 }];
  assert.deepEqual(generateLifecycleMessages(events, events), []);
});

test('ignores new events with no previous state', () => {
  const current = [{ id: 'evt-new', title: 'New event', lifecycle: 'emerging', severity: 40 }];
  assert.deepEqual(generateLifecycleMessages(current, []), []);
});
