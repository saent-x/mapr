import test from 'node:test';
import assert from 'node:assert/strict';
import { __test__ } from '../server/entityDossiers.js';

const { normalizeEntityKey, currentWindowKey, articleMentionsEntity } = __test__;

test('normalizeEntityKey lowercases + slugs', () => {
  assert.equal(normalizeEntityKey('Vladimir Putin'), 'vladimir-putin');
  assert.equal(normalizeEntityKey('  Yevgeny PRIGOZHIN  '), 'yevgeny-prigozhin');
  assert.equal(normalizeEntityKey("Ministry of Foreign Affairs"), 'ministry-of-foreign-affairs');
  assert.equal(normalizeEntityKey(''), '');
});

test('normalizeEntityKey strips combining marks', () => {
  assert.equal(normalizeEntityKey('São Paulo'), 'sao-paulo');
  assert.equal(normalizeEntityKey('Münchner'), 'munchner');
});

test('currentWindowKey returns YYYYMM', () => {
  const k = currentWindowKey(new Date(Date.UTC(2026, 2, 14))); // March 2026
  assert.equal(k, '202603');
});

test('articleMentionsEntity matches NER fields + title fallback', () => {
  const a = {
    title: 'Putin meets Modi in New Delhi',
    payload: JSON.stringify({
      entities: {
        people: [{ name: 'Vladimir Putin' }, { name: 'Narendra Modi' }],
        organizations: [],
        locations: ['New Delhi'],
      },
    }),
  };
  assert.equal(articleMentionsEntity(a, 'vladimir-putin', 'person'), true);
  assert.equal(articleMentionsEntity(a, 'new-delhi', 'location'), true);
  assert.equal(articleMentionsEntity(a, 'wagner-group', 'organization'), false);

  // Title fallback for entities the NER step missed
  const b = { title: 'Wagner Group expands operations', payload: '{}' };
  assert.equal(articleMentionsEntity(b, 'wagner-group', 'organization'), true);
});
