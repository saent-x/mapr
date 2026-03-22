import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from '../server/entityExtractor.js';

test('extracts organizations from English headline', async () => {
  const result = await extractEntities('Wagner Group fighters deployed to Mali amid UN withdrawal');
  assert.ok(result.organizations.some(o => o.name === 'Wagner Group' || o.name.includes('Wagner')));
  assert.ok(result.organizations.some(o => o.name.includes('UN') || o.name === 'United Nations'));
  assert.ok(result.locations.some(l => l.name === 'Mali'));
});

test('extracts people from headline', async () => {
  const result = await extractEntities('President Biden meets with Zelensky in Warsaw');
  assert.ok(result.people.length >= 1);
});

test('extracts from gazetteer for non-English text', async () => {
  const result = await extractEntities('Les forces de Wagner déployées au Mali');
  assert.ok(result.organizations.some(o => o.name === 'Wagner Group' || o.name.includes('Wagner')));
});

test('extracts capitalized multi-word names not in gazetteer', async () => {
  const result = await extractEntities('El presidente Carlos Mendoza visita la zona de desastre');
  assert.ok(result.people.some(p => p.name === 'Carlos Mendoza'));
});

test('classifies event type as disaster', async () => {
  const result = await extractEntities('Earthquake kills 500 in Turkey, rescue operations underway');
  assert.equal(result.category, 'disaster');
});

test('classifies conflict event type', async () => {
  const result = await extractEntities('Rebel forces launch offensive against government troops in Sudan');
  assert.equal(result.category, 'conflict');
});

test('returns empty arrays for empty input', async () => {
  const result = await extractEntities('');
  assert.deepEqual(result.people, []);
  assert.deepEqual(result.organizations, []);
  assert.deepEqual(result.locations, []);
});
