import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/eventInsights.js';

const { eventEntityNames } = __test__;

test('eventEntityNames merges entities from event and articles', () => {
  const event = {
    entities: {
      people: ['Vladimir Putin', { name: 'Sergey Lavrov' }],
      organizations: [{ name: 'Wagner Group' }],
      locations: [],
    },
  };
  const articles = [
    {
      payload: JSON.stringify({
        entities: {
          people: ['Yevgeny Prigozhin'],
          organizations: ['Ministry of Defence'],
          locations: ['Rostov-on-Don'],
        },
      }),
    },
  ];
  const out = eventEntityNames(event, articles);
  assert.ok(out.includes('Vladimir Putin'));
  assert.ok(out.includes('Sergey Lavrov'));
  assert.ok(out.includes('Wagner Group'));
  assert.ok(out.includes('Yevgeny Prigozhin'));
  assert.ok(out.includes('Rostov-on-Don'));
  assert.ok(out.length <= 20);
});

test('eventEntityNames tolerates malformed payloads', () => {
  const out = eventEntityNames({}, [{ payload: 'not-json' }, { payload: '{}' }]);
  assert.deepEqual(out, []);
});
