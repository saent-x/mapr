import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountryCoOccurrences,
  buildGeopoliticalArcData,
  coOccurrenceToStroke,
  coOccurrenceToColor,
  buildCountryStoryMap,
} from '../src/utils/geopoliticalArcs.js';

describe('buildCountryCoOccurrences', () => {
  it('returns empty map for events without countries arrays or entities', () => {
    const result = buildCountryCoOccurrences([
      { id: '1', title: 'test' },
      { id: '2', countries: ['US'] },
    ]);
    assert.equal(result.size, 0);
  });

  it('builds pairs from multi-country events', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU'], severity: 80 },
      { id: 'e2', countries: ['US', 'RU'], severity: 60 },
      { id: 'e3', countries: ['US', 'CN'], severity: 50 },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.equal(result.size, 2);

    const usRu = result.get('RU-US');
    assert.ok(usRu, 'US-RU pair should exist');
    assert.equal(usRu.count, 2);
    assert.equal(usRu.maxSeverity, 80);
    assert.equal(usRu.avgSeverity, 70); // (80+60)/2

    const usCn = result.get('CN-US');
    assert.ok(usCn, 'US-CN pair should exist');
    assert.equal(usCn.count, 1);
  });

  it('handles events with 3+ countries (all pairs)', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU', 'CN'], severity: 90 },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.equal(result.size, 3); // US-RU, US-CN, RU-CN
  });

  it('deduplicates countries within a single event', () => {
    const events = [
      { id: 'e1', countries: ['US', 'US', 'RU'], severity: 50 },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.equal(result.size, 1);
    assert.equal(result.get('RU-US').count, 1);
  });

  it('builds pairs from shared entities across countries', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, entities: { organizations: [{ name: 'NATO' }], people: [] } },
      { id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60, entities: { organizations: [{ name: 'NATO' }], people: [] } },
      { id: 'e3', isoA2: 'DE', countries: ['DE'], severity: 50, entities: { organizations: [{ name: 'NATO' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.ok(result.size >= 3, 'Should have at least 3 pairs: US-FR, US-DE, FR-DE');
    assert.ok(result.has('FR-US'), 'FR-US pair should exist');
    assert.ok(result.has('DE-US'), 'DE-US pair should exist');
    assert.ok(result.has('DE-FR'), 'DE-FR pair should exist');
  });

  it('combines multi-country and entity signals', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US', 'IR'], severity: 90, entities: { organizations: [], people: [] } },
      { id: 'e2', isoA2: 'US', countries: ['US'], severity: 80, entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
      { id: 'e3', isoA2: 'IR', countries: ['IR'], severity: 70, entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    const irUs = result.get('IR-US');
    assert.ok(irUs, 'IR-US pair should exist');
    assert.ok(irUs.count >= 2, 'Should count both multi-country and entity signals');
  });

  it('extracts entities from supportingArticles', () => {
    const events = [
      {
        id: 'e1', isoA2: 'US', countries: ['US'], severity: 80,
        supportingArticles: [
          { entities: { organizations: [{ name: 'NATO' }], people: [] } },
        ],
      },
      {
        id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60,
        supportingArticles: [
          { entities: { organizations: [{ name: 'NATO' }], people: [] } },
        ],
      },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.ok(result.has('FR-US'), 'FR-US pair should exist from supportingArticles entities');
  });

  it('returns empty map for empty input', () => {
    assert.equal(buildCountryCoOccurrences([]).size, 0);
  });
});

describe('buildGeopoliticalArcData', () => {
  const countryStoryMap = {
    US: { coordinates: [38.9, -77.0], region: 'North America', locality: 'Washington' },
    RU: { coordinates: [55.7, 37.6], region: 'Europe', locality: 'Moscow' },
    CN: { coordinates: [39.9, 116.4], region: 'Asia', locality: 'Beijing' },
  };

  it('converts co-occurrences to arc data with coordinates', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU'], severity: 80 },
      { id: 'e2', countries: ['US', 'RU'], severity: 60 },
    ];
    const coOccurrences = buildCountryCoOccurrences(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap);

    assert.equal(arcs.length, 1);
    assert.equal(arcs[0].startIso, 'RU');
    assert.equal(arcs[0].endIso, 'US');
    assert.equal(arcs[0].count, 2);
    assert.equal(arcs[0].type, 'geopolitical');
    assert.equal(arcs[0].startLat, 55.7);
    assert.equal(arcs[0].endLat, 38.9);
  });

  it('skips pairs without coordinates', () => {
    const events = [
      { id: 'e1', countries: ['US', 'XX'], severity: 50 },
    ];
    const coOccurrences = buildCountryCoOccurrences(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap);
    assert.equal(arcs.length, 0);
  });

  it('respects minCount option', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU'], severity: 80 },
      { id: 'e2', countries: ['US', 'CN'], severity: 50 },
      { id: 'e3', countries: ['US', 'RU'], severity: 60 },
    ];
    const coOccurrences = buildCountryCoOccurrences(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap, { minCount: 2 });
    assert.equal(arcs.length, 1); // Only US-RU with count=2
  });

  it('respects maxArcs option', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU', 'CN'], severity: 80 },
    ];
    const coOccurrences = buildCountryCoOccurrences(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap, { maxArcs: 1 });
    assert.equal(arcs.length, 1);
  });

  it('sorts by count descending', () => {
    const events = [
      { id: 'e1', countries: ['US', 'RU'], severity: 80 },
      { id: 'e2', countries: ['US', 'RU'], severity: 60 },
      { id: 'e3', countries: ['US', 'CN'], severity: 90 },
    ];
    const coOccurrences = buildCountryCoOccurrences(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap);
    assert.equal(arcs[0].count, 2); // US-RU has count 2
    assert.equal(arcs[1].count, 1); // US-CN has count 1
  });
});

describe('coOccurrenceToStroke', () => {
  it('returns minimum 1 for zero count', () => {
    assert.equal(coOccurrenceToStroke(0, 10), 1);
  });

  it('returns max around 6 for highest count', () => {
    const stroke = coOccurrenceToStroke(10, 10);
    assert.ok(stroke >= 5.5 && stroke <= 6.1, `Expected ~6, got ${stroke}`);
  });

  it('scales intermediate values with sqrt', () => {
    const low = coOccurrenceToStroke(1, 10);
    const mid = coOccurrenceToStroke(5, 10);
    const high = coOccurrenceToStroke(10, 10);
    assert.ok(low < mid);
    assert.ok(mid < high);
  });

  it('handles maxCount of 0', () => {
    assert.equal(coOccurrenceToStroke(5, 0), 1);
  });
});

describe('coOccurrenceToColor', () => {
  it('returns cyan for low co-occurrence', () => {
    const color = coOccurrenceToColor(1, 10);
    assert.ok(color.includes('0, 212, 255'), `Expected cyan, got ${color}`);
  });

  it('returns amber for medium co-occurrence', () => {
    const color = coOccurrenceToColor(5, 10);
    assert.ok(color.includes('255, 170, 0'), `Expected amber, got ${color}`);
  });

  it('returns red for high co-occurrence', () => {
    const color = coOccurrenceToColor(10, 10);
    assert.ok(color.includes('255, 85, 85'), `Expected red, got ${color}`);
  });

  it('handles maxCount of 0', () => {
    const color = coOccurrenceToColor(5, 0);
    assert.ok(color.includes('0, 212, 255'));
  });
});

describe('buildCountryStoryMap', () => {
  it('maps ISO codes to highest severity stories', () => {
    const stories = [
      { id: 's1', isoA2: 'US', coordinates: [38, -77], severity: 50 },
      { id: 's2', isoA2: 'US', coordinates: [40, -74], severity: 80 },
      { id: 's3', isoA2: 'RU', coordinates: [55, 37], severity: 60 },
    ];
    const map = buildCountryStoryMap(stories);
    assert.equal(map.US.id, 's2'); // Higher severity
    assert.equal(map.RU.id, 's3');
  });

  it('skips stories without coordinates', () => {
    const stories = [
      { id: 's1', isoA2: 'US', severity: 50 },
    ];
    const map = buildCountryStoryMap(stories);
    assert.equal(Object.keys(map).length, 0);
  });

  it('skips stories with [0,0] coordinates', () => {
    const stories = [
      { id: 's1', isoA2: 'US', coordinates: [0, 0], severity: 50 },
    ];
    const map = buildCountryStoryMap(stories);
    assert.equal(Object.keys(map).length, 0);
  });

  it('skips stories without isoA2', () => {
    const stories = [
      { id: 's1', coordinates: [38, -77], severity: 50 },
    ];
    const map = buildCountryStoryMap(stories);
    assert.equal(Object.keys(map).length, 0);
  });
});
