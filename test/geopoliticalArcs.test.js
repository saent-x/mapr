import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildCountryCoOccurrences,
  buildGeopoliticalArcData,
  coOccurrenceToStroke,
  coOccurrenceToColor,
  buildCountryStoryMap,
  HIGH_FREQUENCY_ENTITIES,
  jaccardTokenSimilarity,
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

  it('builds pairs from shared entities across countries with ALL event IDs', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, title: 'Zelensky meets Biden to discuss military aid for Ukraine', entities: { organizations: [], people: [{ name: 'Zelensky' }] } },
      { id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60, title: 'France hosts Zelensky for Ukraine military aid summit', entities: { organizations: [], people: [{ name: 'Zelensky' }] } },
      { id: 'e3', isoA2: 'DE', countries: ['DE'], severity: 50, title: 'Germany pledges Zelensky military aid package for Ukraine', entities: { organizations: [], people: [{ name: 'Zelensky' }] } },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.ok(result.size >= 3, 'Should have at least 3 pairs: US-FR, US-DE, FR-DE');
    assert.ok(result.has('FR-US'), 'FR-US pair should exist');
    assert.ok(result.has('DE-US'), 'DE-US pair should exist');
    assert.ok(result.has('DE-FR'), 'DE-FR pair should exist');

    // Each pair should have storyIds from BOTH contributing countries
    const frUs = result.get('FR-US');
    assert.ok(frUs.storyIds.includes('e1'), 'FR-US should include US event e1');
    assert.ok(frUs.storyIds.includes('e2'), 'FR-US should include FR event e2');

    const deUs = result.get('DE-US');
    assert.ok(deUs.storyIds.includes('e1'), 'DE-US should include US event e1');
    assert.ok(deUs.storyIds.includes('e3'), 'DE-US should include DE event e3');

    const deFr = result.get('DE-FR');
    assert.ok(deFr.storyIds.includes('e2'), 'DE-FR should include FR event e2');
    assert.ok(deFr.storyIds.includes('e3'), 'DE-FR should include DE event e3');
  });

  it('combines multi-country and entity signals', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US', 'IR'], severity: 90, title: 'US Iran tensions escalate over nuclear deal', entities: { organizations: [], people: [] } },
      { id: 'e2', isoA2: 'US', countries: ['US'], severity: 80, title: 'Pentagon officials discuss Iran military buildup', entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
      { id: 'e3', isoA2: 'IR', countries: ['IR'], severity: 70, title: 'Iran responds to Pentagon military threats', entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    const irUs = result.get('IR-US');
    assert.ok(irUs, 'IR-US pair should exist');
    assert.ok(irUs.count >= 2, 'Should count both multi-country and entity signals');
  });

  it('extracts entities from supportingArticles', () => {
    const events = [
      {
        id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, title: 'Macron visits Washington for defense cooperation talks',
        supportingArticles: [
          { entities: { organizations: [{ name: 'Elysée Palace' }], people: [] } },
        ],
      },
      {
        id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60, title: 'France and Washington announce defense cooperation deal',
        supportingArticles: [
          { entities: { organizations: [{ name: 'Elysée Palace' }], people: [] } },
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

describe('entity-derived arc drilldown', () => {
  it('storyIds on entity-derived arcs resolve correct events for drilldown', () => {
    // Entity-derived arcs: events share a specific entity (Zelensky) across countries,
    // but each event only has a single country in its countries array.
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, title: 'Biden meets Zelensky to discuss Ukraine military aid', entities: { organizations: [], people: [{ name: 'Zelensky' }] }, coordinates: [38.9, -77.0] },
      { id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60, title: 'France hosts Zelensky for Ukraine military aid talks', entities: { organizations: [], people: [{ name: 'Zelensky' }] }, coordinates: [48.8, 2.3] },
      { id: 'e3', isoA2: 'DE', countries: ['DE'], severity: 50, title: 'Germany pledges Zelensky military aid for Ukraine defense', entities: { organizations: [], people: [{ name: 'Zelensky' }] }, coordinates: [52.5, 13.4] },
    ];

    const coOccurrences = buildCountryCoOccurrences(events);
    const countryStoryMap = buildCountryStoryMap(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap);

    // Each arc should have storyIds populated from entity co-occurrence
    for (const arc of arcs) {
      assert.ok(Array.isArray(arc.storyIds), `Arc ${arc.id} should have storyIds array`);
      assert.ok(arc.storyIds.length > 0, `Arc ${arc.id} storyIds should not be empty`);
    }

    // FR-US arc should reference at least one event from each side
    const frUs = arcs.find((a) => a.id === 'FR-US');
    assert.ok(frUs, 'FR-US arc should exist');
    assert.ok(frUs.storyIds.length > 0, 'FR-US arc should have contributing storyIds');

    // Simulate ArcPanel drilldown: resolve shared events from storyIds
    // (This is the logic now used in ArcPanel.jsx for geopolitical arcs)
    const storyIdSet = new Set(frUs.storyIds);
    const resolvedShared = events.filter((e) => storyIdSet.has(e.id));
    assert.ok(resolvedShared.length > 0, 'Drilldown should resolve contributing events from storyIds');

    // The old countries-only approach would fail here because no event has both FR and US
    const countriesOnlyShared = events.filter(
      (e) => Array.isArray(e.countries) && e.countries.includes('FR') && e.countries.includes('US'),
    );
    assert.equal(countriesOnlyShared.length, 0, 'Countries-only filter finds nothing for entity-derived arcs');
  });

  it('storyIds include both multi-country and entity-linked event IDs', () => {
    const events = [
      // Multi-country event
      { id: 'mc1', isoA2: 'US', countries: ['US', 'IR'], severity: 90, title: 'US Iran tensions escalate over nuclear dispute', entities: { organizations: [], people: [] }, coordinates: [38.9, -77.0] },
      // Entity-linked events (shared entity Pentagon)
      { id: 'ent1', isoA2: 'US', countries: ['US'], severity: 80, title: 'Pentagon officials discuss Iran military buildup', entities: { organizations: [{ name: 'Pentagon' }], people: [] }, coordinates: [38.9, -77.0] },
      { id: 'ent2', isoA2: 'IR', countries: ['IR'], severity: 70, title: 'Iran responds to Pentagon military threats', entities: { organizations: [{ name: 'Pentagon' }], people: [] }, coordinates: [35.7, 51.4] },
    ];

    const coOccurrences = buildCountryCoOccurrences(events);
    const countryStoryMap = buildCountryStoryMap(events);
    const arcs = buildGeopoliticalArcData(coOccurrences, countryStoryMap);

    const irUs = arcs.find((a) => a.id === 'IR-US');
    assert.ok(irUs, 'IR-US arc should exist');

    // Should include the multi-country event AND entity-linked events
    assert.ok(irUs.storyIds.includes('mc1'), 'storyIds should include multi-country event');
    // At least one entity-linked event should be in storyIds
    const hasEntityEvent = irUs.storyIds.includes('ent1') || irUs.storyIds.includes('ent2');
    assert.ok(hasEntityEvent, 'storyIds should include at least one entity-linked event');

    // Drilldown via storyIds resolves all contributing events
    const storyIdSet = new Set(irUs.storyIds);
    const resolvedShared = events.filter((e) => storyIdSet.has(e.id));
    assert.ok(resolvedShared.length >= 2, 'Drilldown should resolve both multi-country and entity-linked events');
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

describe('HIGH_FREQUENCY_ENTITIES', () => {
  it('contains common global organizations', () => {
    for (const org of ['UN', 'NATO', 'EU', 'WHO', 'IMF', 'World Bank', 'ASEAN', 'AU', 'ECOWAS']) {
      assert.ok(HIGH_FREQUENCY_ENTITIES.has(org), `Should contain ${org}`);
    }
  });

  it('does not contain specific entities', () => {
    for (const name of ['Zelensky', 'Pentagon', 'Kremlin', 'White House']) {
      assert.ok(!HIGH_FREQUENCY_ENTITIES.has(name), `Should NOT contain ${name}`);
    }
  });
});

describe('jaccardTokenSimilarity', () => {
  it('returns 0 for empty or null inputs', () => {
    assert.equal(jaccardTokenSimilarity('', 'hello'), 0);
    assert.equal(jaccardTokenSimilarity(null, 'hello'), 0);
    assert.equal(jaccardTokenSimilarity('hello', undefined), 0);
  });

  it('returns 1 for identical titles', () => {
    assert.equal(jaccardTokenSimilarity('hello world', 'hello world'), 1);
  });

  it('returns 0 for completely different titles', () => {
    assert.equal(jaccardTokenSimilarity('apple banana cherry', 'dog elephant fox'), 0);
  });

  it('computes partial overlap correctly', () => {
    // "ukraine military aid" vs "france military cooperation"
    // Set A: {ukraine, military, aid}, Set B: {france, military, cooperation}
    // Intersection: {military} = 1, Union = 5, Jaccard = 0.2
    const sim = jaccardTokenSimilarity('ukraine military aid', 'france military cooperation');
    assert.ok(sim > 0.15, `Expected > 0.15, got ${sim}`);
    assert.ok(sim < 0.5, `Expected < 0.5, got ${sim}`);
  });

  it('is case-insensitive', () => {
    assert.equal(
      jaccardTokenSimilarity('Ukraine Crisis', 'ukraine crisis'),
      1,
    );
  });
});

describe('co-occurrence relevance filtering', () => {
  it('NATO mention in US+France news does NOT create entity arc', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 70, title: 'US announces new NATO defense spending commitments', entities: { organizations: [{ name: 'NATO' }], people: [] } },
      { id: 'e2', isoA2: 'FR', countries: ['FR'], severity: 60, title: 'France holds bilateral trade talks with Germany', entities: { organizations: [{ name: 'NATO' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    // NATO is a high-frequency entity, so no entity-based arc should be created.
    // There is no multi-country co-occurrence either (each event has only one country).
    assert.ok(!result.has('FR-US'), 'FR-US pair should NOT exist when only shared entity is NATO');
  });

  it('specific entity like Zelensky in US+Ukraine news DOES create arc', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, title: 'Biden meets Zelensky to discuss Ukraine military aid', entities: { organizations: [], people: [{ name: 'Zelensky' }] } },
      { id: 'e2', isoA2: 'UA', countries: ['UA'], severity: 75, title: 'Ukraine president Zelensky seeks military aid from allies', entities: { organizations: [], people: [{ name: 'Zelensky' }] } },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.ok(result.has('UA-US'), 'UA-US pair SHOULD exist for specific entity Zelensky with related titles');
    const uaUs = result.get('UA-US');
    assert.ok(uaUs.storyIds.includes('e1'), 'Should include US event');
    assert.ok(uaUs.storyIds.includes('e2'), 'Should include UA event');
  });

  it('multi-country events still create arcs without filtering', () => {
    // Even if the only shared entity is NATO, multi-country events are not filtered
    const events = [
      { id: 'e1', countries: ['US', 'FR'], severity: 70, title: 'US and France discuss NATO defense spending', entities: { organizations: [{ name: 'NATO' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    assert.ok(result.has('FR-US'), 'FR-US pair SHOULD exist from multi-country event (unfiltered)');
  });

  it('title similarity filters topically unrelated entity pairs', () => {
    // Same specific entity (SpaceX) appears in completely unrelated stories
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 50, title: 'SpaceX launches new satellite constellation', entities: { organizations: [{ name: 'SpaceX' }], people: [] } },
      { id: 'e2', isoA2: 'BR', countries: ['BR'], severity: 40, title: 'Brazil Amazon deforestation reaches record levels', entities: { organizations: [{ name: 'SpaceX' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    // Titles are completely unrelated (Jaccard ≈ 0), so no arc should be created
    assert.ok(!result.has('BR-US'), 'BR-US pair should NOT exist when shared entity appears in unrelated stories');
  });

  it('allows entity pairing when events lack titles (lenient fallback)', () => {
    const events = [
      { id: 'e1', isoA2: 'US', countries: ['US'], severity: 80, entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
      { id: 'e2', isoA2: 'IR', countries: ['IR'], severity: 70, entities: { organizations: [{ name: 'Pentagon' }], people: [] } },
    ];
    const result = buildCountryCoOccurrences(events);
    // No titles means similarity check is skipped (lenient), so arc should still be created
    assert.ok(result.has('IR-US'), 'IR-US pair SHOULD exist when events have no titles (lenient fallback)');
  });
});
