import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTimelineStages,
  computeSourceDiversity,
  computeStageDiversity,
  findCrossRegionalSpread,
  buildNarrativeTimeline,
} from '../src/utils/narrativeHelpers.js';

/* ── helpers ── */
function makeArticle(overrides = {}) {
  return {
    id: `art-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Test article',
    source: 'Test Source',
    url: 'https://example.com/test',
    publishedAt: new Date().toISOString(),
    sourceType: 'wire',
    isoA2: 'US',
    ...overrides,
  };
}

function makeEvent(overrides = {}) {
  return {
    id: `evt-${Math.random().toString(36).slice(2, 8)}`,
    title: 'Major earthquake strikes Turkey causing widespread damage',
    source: 'Reuters',
    isoA2: 'TR',
    severity: 80,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
    supportingArticles: [],
    ...overrides,
  };
}

describe('buildTimelineStages', () => {
  it('returns empty array for no articles', () => {
    assert.deepStrictEqual(buildTimelineStages([]), []);
    assert.deepStrictEqual(buildTimelineStages(null), []);
  });

  it('marks single article as first report', () => {
    const articles = [makeArticle({ publishedAt: '2025-01-01T10:00:00Z' })];
    const stages = buildTimelineStages(articles);
    assert.strictEqual(stages.length, 1);
    assert.strictEqual(stages[0].label, 'first');
    assert.strictEqual(stages[0].articles.length, 1);
  });

  it('groups articles within 2-hour window into same stage', () => {
    const articles = [
      makeArticle({ publishedAt: '2025-01-01T10:00:00Z', source: 'Reuters' }),
      makeArticle({ publishedAt: '2025-01-01T10:30:00Z', source: 'AP' }),
      makeArticle({ publishedAt: '2025-01-01T11:45:00Z', source: 'BBC' }),
    ];
    const stages = buildTimelineStages(articles);
    assert.strictEqual(stages.length, 1);
    assert.strictEqual(stages[0].articles.length, 3);
  });

  it('creates separate stage for articles beyond 2-hour window', () => {
    const articles = [
      makeArticle({ publishedAt: '2025-01-01T08:00:00Z', source: 'Reuters' }),
      makeArticle({ publishedAt: '2025-01-01T12:00:00Z', source: 'BBC' }),
      makeArticle({ publishedAt: '2025-01-01T18:00:00Z', source: 'Al Jazeera' }),
    ];
    const stages = buildTimelineStages(articles);
    assert.strictEqual(stages.length, 3);
    assert.strictEqual(stages[0].label, 'first');
    assert.strictEqual(stages[1].label, 'developing');
    assert.strictEqual(stages[2].label, 'continued');
  });

  it('sorts articles chronologically regardless of input order', () => {
    const articles = [
      makeArticle({ publishedAt: '2025-01-01T14:00:00Z', source: 'Late' }),
      makeArticle({ publishedAt: '2025-01-01T08:00:00Z', source: 'Early' }),
    ];
    const stages = buildTimelineStages(articles);
    assert.strictEqual(stages[0].articles[0].source, 'Early');
  });
});

describe('computeSourceDiversity', () => {
  it('returns empty array for no articles', () => {
    assert.deepStrictEqual(computeSourceDiversity([]), []);
    assert.deepStrictEqual(computeSourceDiversity(null), []);
  });

  it('counts source types correctly', () => {
    const articles = [
      makeArticle({ sourceType: 'wire' }),
      makeArticle({ sourceType: 'wire' }),
      makeArticle({ sourceType: 'local' }),
      makeArticle({ sourceType: 'regional' }),
    ];
    const diversity = computeSourceDiversity(articles);
    assert.strictEqual(diversity.length, 3);

    const wire = diversity.find((d) => d.type === 'wire');
    assert.strictEqual(wire.count, 2);

    const local = diversity.find((d) => d.type === 'local');
    assert.strictEqual(local.count, 1);
  });

  it('follows SOURCE_TYPE_ORDER for output', () => {
    const articles = [
      makeArticle({ sourceType: 'local' }),
      makeArticle({ sourceType: 'wire' }),
      makeArticle({ sourceType: 'official' }),
    ];
    const diversity = computeSourceDiversity(articles);
    const types = diversity.map((d) => d.type);
    assert.deepStrictEqual(types, ['official', 'wire', 'local']);
  });
});

describe('computeStageDiversity', () => {
  it('returns source types present in each stage', () => {
    const stages = [
      {
        label: 'first',
        startTime: Date.now(),
        articles: [
          makeArticle({ sourceType: 'wire' }),
          makeArticle({ sourceType: 'local' }),
        ],
      },
      {
        label: 'developing',
        startTime: Date.now() + 1000,
        articles: [
          makeArticle({ sourceType: 'regional' }),
        ],
      },
    ];
    const result = computeStageDiversity(stages);
    assert.strictEqual(result.length, 2);
    assert.ok(result[0].sourceTypes.includes('wire'));
    assert.ok(result[0].sourceTypes.includes('local'));
    assert.strictEqual(result[0].articleCount, 2);
    assert.deepStrictEqual(result[1].sourceTypes, ['regional']);
  });
});

describe('findCrossRegionalSpread', () => {
  it('returns empty for null/missing input', () => {
    assert.deepStrictEqual(findCrossRegionalSpread(null, []), []);
    assert.deepStrictEqual(findCrossRegionalSpread(makeEvent(), null), []);
  });

  it('does not match events in the same region', () => {
    const selected = makeEvent({ isoA2: 'TR', title: 'Major earthquake in Turkey' });
    const others = [
      makeEvent({ isoA2: 'TR', title: 'Major earthquake in Turkey rescue efforts' }),
    ];
    const result = findCrossRegionalSpread(selected, others);
    assert.strictEqual(result.length, 0);
  });

  it('finds similar events in other regions', () => {
    const selected = makeEvent({
      isoA2: 'TR',
      title: 'Major earthquake strikes Turkey causing widespread destruction',
    });
    const others = [
      makeEvent({
        isoA2: 'SY',
        title: 'Major earthquake strikes Syria causing widespread destruction and damage',
      }),
      makeEvent({
        isoA2: 'US',
        title: 'Completely unrelated political news about elections in America',
      }),
    ];
    const result = findCrossRegionalSpread(selected, others);
    assert.ok(result.length >= 1, 'Should find the Syria earthquake event');
    assert.strictEqual(result[0].event.isoA2, 'SY');
  });

  it('limits results to 10', () => {
    const selected = makeEvent({
      isoA2: 'TR',
      title: 'Global climate summit agreement reached world leaders celebrate',
    });
    const others = Array.from({ length: 20 }, (_, i) =>
      makeEvent({
        isoA2: `X${i}`,
        title: 'Global climate summit agreement reached world leaders celebrate progress',
      })
    );
    const result = findCrossRegionalSpread(selected, others);
    assert.ok(result.length <= 10);
  });

  it('sorts by descending similarity', () => {
    const selected = makeEvent({
      isoA2: 'US',
      title: 'Massive flooding devastates coastal cities emergency response underway',
    });
    const others = [
      makeEvent({
        isoA2: 'UK',
        title: 'Massive flooding devastates coastal cities emergency response underway immediately',
      }),
      makeEvent({
        isoA2: 'AU',
        title: 'Flooding devastates coastal areas emergency response',
      }),
    ];
    const result = findCrossRegionalSpread(selected, others);
    if (result.length >= 2) {
      assert.ok(result[0].similarity >= result[1].similarity);
    }
  });
});

describe('buildNarrativeTimeline', () => {
  it('returns complete narrative structure', () => {
    const event = makeEvent({
      supportingArticles: [
        makeArticle({ publishedAt: '2025-01-01T10:00:00Z', sourceType: 'wire', source: 'Reuters' }),
        makeArticle({ publishedAt: '2025-01-01T14:00:00Z', sourceType: 'local', source: 'Local News' }),
      ],
    });
    const result = buildNarrativeTimeline(event, []);
    assert.ok(result.stages.length > 0, 'should have stages');
    assert.ok(result.diversity.length > 0, 'should have diversity');
    assert.ok(result.firstReportedAt, 'should have firstReportedAt');
    assert.ok(result.lastReportedAt, 'should have lastReportedAt');
    assert.ok(result.timeSpanMs >= 0, 'should have non-negative timeSpan');
    assert.ok(Array.isArray(result.crossRegional), 'should have crossRegional array');
    assert.ok(Array.isArray(result.stageDiversity), 'should have stageDiversity array');
  });

  it('handles event with no supporting articles', () => {
    const event = makeEvent({ supportingArticles: [] });
    const result = buildNarrativeTimeline(event, []);
    assert.strictEqual(result.stages.length, 0);
    assert.strictEqual(result.diversity.length, 0);
  });

  it('calculates correct time span', () => {
    const event = makeEvent({
      supportingArticles: [
        makeArticle({ publishedAt: '2025-01-01T10:00:00Z' }),
        makeArticle({ publishedAt: '2025-01-01T22:00:00Z' }),
      ],
    });
    const result = buildNarrativeTimeline(event, []);
    assert.strictEqual(result.timeSpanMs, 12 * 60 * 60 * 1000); // 12 hours
  });

  it('includes cross-regional matches from allEvents', () => {
    const event = makeEvent({
      isoA2: 'TR',
      title: 'Major earthquake strikes Turkey causing widespread destruction and damage',
      supportingArticles: [
        makeArticle({ publishedAt: '2025-01-01T10:00:00Z' }),
      ],
    });
    const allEvents = [
      event,
      makeEvent({
        isoA2: 'SY',
        title: 'Major earthquake strikes Syria causing widespread destruction and damage',
      }),
    ];
    const result = buildNarrativeTimeline(event, allEvents);
    assert.ok(result.crossRegional.length >= 1, 'Should detect cross-regional spread');
  });
});
