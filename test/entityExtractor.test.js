import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities, normalizeEntityName, normalizeEntityList } from '../server/entityExtractor.js';

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

// ── Multi-word entity tests ───────────────────────────────────────────────────

test('extracts United Nations as a single multi-word entity', async () => {
  const result = await extractEntities('United Nations peacekeepers deployed to South Sudan');
  const orgNames = result.organizations.map(o => o.name);
  assert.ok(
    orgNames.some(n => n === 'United Nations'),
    `Expected 'United Nations' in organizations, got: ${orgNames.join(', ')}`
  );
});

test('extracts Red Cross as a single multi-word entity', async () => {
  const result = await extractEntities('Red Cross delivers aid to flood victims in Bangladesh');
  const orgNames = result.organizations.map(o => o.name);
  assert.ok(
    orgNames.some(n => n.toLowerCase().includes('red cross')),
    `Expected 'Red Cross' in organizations, got: ${orgNames.join(', ')}`
  );
});

test('extracts European Union as a single entity from text', async () => {
  const result = await extractEntities('European Union imposes new sanctions on Belarus');
  const orgNames = result.organizations.map(o => o.name);
  assert.ok(
    orgNames.some(n => n === 'European Union'),
    `Expected 'European Union' in organizations, got: ${orgNames.join(', ')}`
  );
});

test('extracts World Health Organization as a single entity', async () => {
  const result = await extractEntities('World Health Organization declares end of outbreak');
  const orgNames = result.organizations.map(o => o.name);
  assert.ok(
    orgNames.some(n => n === 'World Health Organization' || n === 'WHO'),
    `Expected WHO in organizations, got: ${orgNames.join(', ')}`
  );
});

// ── Entity normalization tests ─────────────────────────────────────────────────

test('normalizeEntityName maps U.S. to canonical USA', () => {
  assert.equal(normalizeEntityName('U.S.'), 'USA');
  assert.equal(normalizeEntityName('U.S.A.'), 'USA');
  assert.equal(normalizeEntityName('US'), 'USA');
  assert.equal(normalizeEntityName('United States'), 'USA');
});

test('normalizeEntityName maps UK to United Kingdom', () => {
  assert.equal(normalizeEntityName('UK'), 'United Kingdom');
  assert.equal(normalizeEntityName('U.K.'), 'United Kingdom');
});

test('normalizeEntityName maps UN to United Nations', () => {
  assert.equal(normalizeEntityName('UN'), 'United Nations');
  assert.equal(normalizeEntityName('U.N.'), 'United Nations');
});

test('normalizeEntityName maps EU to European Union', () => {
  assert.equal(normalizeEntityName('EU'), 'European Union');
  assert.equal(normalizeEntityName('E.U.'), 'European Union');
});

test('normalizeEntityName returns unchanged for unmapped names', () => {
  assert.equal(normalizeEntityName('Canada'), 'Canada');
  assert.equal(normalizeEntityName('Brazil'), 'Brazil');
  assert.equal(normalizeEntityName('Microsoft'), 'Microsoft');
});

test('normalizeEntityName handles empty/null input', () => {
  assert.equal(normalizeEntityName(''), '');
  assert.equal(normalizeEntityName(null), '');
  assert.equal(normalizeEntityName(undefined), '');
});

test('normalizeEntityList deduplicates by canonical name', () => {
  const entities = [
    { name: 'U.S.' },
    { name: 'USA' },
    { name: 'United States' },
    { name: 'Canada' },
    { name: 'UK' },
    { name: 'United Kingdom' },
  ];
  const normalized = normalizeEntityList(entities);

  // U.S./USA/United States → single USA entry
  const usaEntries = normalized.filter(e => e.name === 'USA');
  assert.equal(usaEntries.length, 1);

  // UK/United Kingdom → single United Kingdom entry
  const ukEntries = normalized.filter(e => e.name === 'United Kingdom');
  assert.equal(ukEntries.length, 1);

  // Canada should remain as-is
  assert.ok(normalized.some(e => e.name === 'Canada'));

  // Total should be 3 unique entities
  assert.equal(normalized.length, 3);
});

test('extractEntities normalizes US variants in output', async () => {
  const result = await extractEntities('U.S. and EU officials meet USA delegation');
  const orgNames = result.organizations.map(o => o.name);

  // Should not have both U.S. and USA separately
  const usVariants = orgNames.filter(n => n === 'USA' || n === 'U.S.' || n === 'United States');
  assert.ok(usVariants.length <= 1, `Should have at most one US variant, got: ${usVariants.join(', ')}`);

  // EU should normalize to European Union
  assert.ok(
    orgNames.some(n => n === 'European Union'),
    `Expected European Union in orgs, got: ${orgNames.join(', ')}`
  );
});

test('extractEntities does not extract common nouns as named entities', async () => {
  const result = await extractEntities('The government announced new policies today');
  // 'the government' should not appear as a named entity
  const orgNames = result.organizations.map(o => o.name.toLowerCase());
  assert.ok(!orgNames.includes('the government'), 'common noun "the government" should not be extracted');
  assert.ok(!orgNames.includes('government'), 'bare "government" should not be extracted');
});

test('extractEntities does not extract "the president" as a named person', async () => {
  const result = await extractEntities('The president gave a speech about the economy');
  const personNames = result.people.map(p => p.name.toLowerCase());
  assert.ok(!personNames.includes('the president'), 'common noun "the president" should not be extracted');
});
