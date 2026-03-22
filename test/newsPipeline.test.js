import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalizeArticles, tokenizeHeadline, jaccardSimilarity } from '../src/utils/newsPipeline.js';

test('tokenizeHeadline is exported and works', () => {
  const tokens = tokenizeHeadline('Wagner Group fighters deployed to Mali');
  assert.ok(Array.isArray(tokens));
  assert.ok(tokens.includes('wagner'));
  assert.ok(tokens.includes('mali'));
  assert.ok(!tokens.includes('the'));
});

test('jaccardSimilarity is exported and works', () => {
  const a = ['wagner', 'group', 'mali'];
  const b = ['wagner', 'group', 'libya'];
  const score = jaccardSimilarity(a, b);
  assert.ok(score > 0.4);
  assert.ok(score < 0.8);
});

function createArticle(overrides = {}) {
  return {
    id: overrides.id || 'article-1',
    isoA2: overrides.isoA2 || 'JP',
    region: overrides.region || 'Japan',
    locality: overrides.locality === undefined ? 'Tokyo' : overrides.locality,
    coordinates: overrides.coordinates || [35.6764, 139.65],
    title: overrides.title || 'Tokyo officials issue earthquake warning after tremor',
    summary: overrides.summary || overrides.title || 'Tokyo officials issue earthquake warning after tremor',
    publishedAt: overrides.publishedAt || '2026-03-15T10:00:00.000Z',
    severity: overrides.severity ?? 80,
    category: overrides.category || 'Disaster',
    source: overrides.source || 'Reuters',
    sourceCountry: overrides.sourceCountry,
    language: overrides.language || 'en',
    geocodePrecision: overrides.geocodePrecision,
    geocodeMatchedOn: overrides.geocodeMatchedOn
  };
}

test('canonicalizeArticles adds positive confidence reasons for corroborated high-trust events', () => {
  const events = canonicalizeArticles([
    createArticle({
      id: 'official-1',
      source: 'reliefweb',
      sourceCountry: 'JP',
      title: 'Tokyo officials issue earthquake warning after tremor',
      summary: 'Officials in Tokyo issued an earthquake warning after a strong tremor.',
      publishedAt: '2026-03-15T10:00:00.000Z'
    }),
    createArticle({
      id: 'wire-1',
      source: 'Reuters',
      sourceCountry: 'GB',
      title: 'Tokyo officials issue earthquake warning after tremor, Reuters says',
      summary: 'Reuters confirms the warning in Tokyo after the tremor.',
      coordinates: [35.68, 139.68],
      publishedAt: '2026-03-15T10:30:00.000Z'
    }),
    createArticle({
      id: 'global-1',
      source: 'BBC News',
      sourceCountry: 'GB',
      title: 'BBC reports Tokyo earthquake warning after tremor',
      summary: 'BBC reports officials in Tokyo warning residents after the quake.',
      coordinates: [35.67, 139.69],
      publishedAt: '2026-03-15T11:00:00.000Z'
    })
  ]);

  assert.equal(events.length, 1);

  const event = events[0];
  const reasonTypes = new Set(event.confidenceReasons.map((reason) => reason.type));

  assert.equal(event.verificationStatus, 'official');
  assert.ok(event.confidence >= 80);
  assert.equal(event.sourceCount, 3);
  assert.equal(event.independentSourceCount, 3);
  assert.ok(reasonTypes.has('official-source'));
  assert.ok(reasonTypes.has('corroborated-sources'));
  assert.ok(reasonTypes.has('locality-precision'));
  assert.ok(reasonTypes.has('diverse-source-types'));
  assert.ok(reasonTypes.has('cross-border-sources'));
  assert.ok(reasonTypes.has('trusted-sources'));
});

test('canonicalizeArticles flags source-country fallback when location precision is weak', () => {
  const events = canonicalizeArticles([
    createArticle({
      id: 'fallback-1',
      isoA2: 'ML',
      region: 'Mali',
      locality: undefined,
      coordinates: [17.5707, -3.9962],
      title: 'Regional outlets report clashes in Mali border area',
      summary: 'Regional outlets report clashes in a border area of Mali.',
      category: 'Conflict',
      source: 'Sahel Monitor',
      sourceCountry: 'ML',
      geocodePrecision: 'source-country'
    })
  ]);

  assert.equal(events.length, 1);

  const event = events[0];
  const reasonTypes = new Set(event.confidenceReasons.map((reason) => reason.type));

  assert.equal(event.geocodePrecision, 'source-country');
  assert.ok(reasonTypes.has('source-country-fallback'));
  assert.equal(event.verificationStatus, 'single-source');
});

test('canonicalizeArticles does not over-verify syndicated coverage from one source network', () => {
  const events = canonicalizeArticles([
    createArticle({
      id: 'reuters-1',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.5244, 3.3792],
      title: 'Reuters reports flooding disrupts transport in Lagos',
      summary: 'Reuters reports major flooding disrupting transport in Lagos.',
      category: 'Disaster',
      source: 'Reuters',
      sourceCountry: 'GB',
      publishedAt: '2026-03-15T12:00:00.000Z'
    }),
    createArticle({
      id: 'reuters-2',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.53, 3.38],
      title: 'Reuters Africa says flooding disrupts transport in Lagos',
      summary: 'Reuters Africa also reports transport disruption after flooding in Lagos.',
      category: 'Disaster',
      source: 'Reuters Africa',
      sourceCountry: 'ZA',
      publishedAt: '2026-03-15T12:30:00.000Z'
    })
  ]);

  assert.equal(events.length, 1);

  const event = events[0];
  const reasonTypes = new Set(event.confidenceReasons.map((reason) => reason.type));

  assert.equal(event.sourceCount, 2);
  assert.equal(event.independentSourceCount, 1);
  assert.equal(event.verificationStatus, 'single-source');
  assert.ok(!reasonTypes.has('corroborated-sources'));
});

test('canonicalizeArticles reduces confidence when location signals conflict', () => {
  const cleanEvent = canonicalizeArticles([
    createArticle({
      id: 'clean-1',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.5244, 3.3792],
      title: 'Flooding disrupts transport in Lagos',
      summary: 'Flooding disrupts transport in Lagos after heavy rain.',
      source: 'Reuters',
      sourceCountry: 'GB',
      geocodeMatchedOn: 'title-city'
    }),
    createArticle({
      id: 'clean-2',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.53, 3.38],
      title: 'BBC reports flooding disrupts transport in Lagos',
      summary: 'BBC reports heavy flooding in Lagos.',
      source: 'BBC News',
      sourceCountry: 'GB',
      geocodeMatchedOn: 'title-city'
    })
  ])[0];

  const conflictedEvent = canonicalizeArticles([
    createArticle({
      id: 'conflict-1',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Nigeria',
      coordinates: [9.082, 8.6753],
      title: 'Paris summit on unrest in Nigeria begins today',
      summary: 'Leaders meet in Paris over unrest in Nigeria.',
      source: 'Reuters',
      sourceCountry: 'GB',
      geocodePrecision: 'country',
      geocodeMatchedOn: 'title-country-conflict'
    }),
    createArticle({
      id: 'conflict-2',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Nigeria',
      coordinates: [9.082, 8.6753],
      title: 'BBC says Paris summit focuses on Nigeria unrest',
      summary: 'BBC reports a Paris summit about unrest in Nigeria.',
      source: 'BBC News',
      sourceCountry: 'GB',
      geocodePrecision: 'country',
      geocodeMatchedOn: 'title-country-conflict'
    })
  ])[0];

  const reasonTypes = new Set(conflictedEvent.confidenceReasons.map((reason) => reason.type));

  assert.ok(conflictedEvent.confidence < cleanEvent.confidence);
  assert.ok(reasonTypes.has('conflicting-location-signals'));
  assert.equal(conflictedEvent.geocodeMatchedOn, 'title-country-conflict');
});

test('canonicalizeArticles flags summary-derived locations when no title location is present', () => {
  const event = canonicalizeArticles([
    createArticle({
      id: 'summary-1',
      isoA2: 'BR',
      region: 'Brazil',
      locality: 'Sao Paulo',
      coordinates: [-23.55, -46.63],
      title: 'Authorities respond after severe flooding',
      summary: 'Emergency teams were deployed across Sao Paulo after severe flooding.',
      source: 'Reuters',
      sourceCountry: 'GB',
      geocodeMatchedOn: 'summary-city'
    }),
    createArticle({
      id: 'summary-2',
      isoA2: 'BR',
      region: 'Brazil',
      locality: 'Sao Paulo',
      coordinates: [-23.56, -46.62],
      title: 'BBC covers emergency response after severe flooding',
      summary: 'BBC says Sao Paulo authorities are responding to severe flooding.',
      source: 'BBC News',
      sourceCountry: 'GB',
      geocodeMatchedOn: 'summary-city'
    })
  ])[0];

  const reasonTypes = new Set(event.confidenceReasons.map((reason) => reason.type));

  assert.ok(reasonTypes.has('summary-derived-location'));
  assert.equal(event.geocodeMatchedOn, 'summary-city');
});

test('canonicalizeArticles assigns distinct ids to separate events with similar title prefixes', () => {
  const events = canonicalizeArticles([
    createArticle({
      id: 'lagos-port',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.5244, 3.3792],
      title: 'Lagos bulletin update on port customs audit delays cargo',
      summary: 'Port customs audit delays cargo processing across Lagos terminals.',
      category: 'Infrastructure',
      source: 'Reuters',
      sourceCountry: 'GB'
    }),
    createArticle({
      id: 'lagos-hospital',
      isoA2: 'NG',
      region: 'Nigeria',
      locality: 'Lagos',
      coordinates: [6.5244, 3.3792],
      title: 'Lagos bulletin update on hospital funding dispute sparks walkout',
      summary: 'A hospital funding dispute sparks a walkout in Lagos.',
      category: 'Health',
      source: 'BBC News',
      sourceCountry: 'GB',
      publishedAt: '2026-03-15T11:30:00.000Z'
    })
  ]);

  assert.equal(events.length, 2);
  assert.notEqual(events[0].id, events[1].id);
});
