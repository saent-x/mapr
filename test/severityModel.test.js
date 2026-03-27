import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCompositeSeverity } from '../src/utils/severityModel.js';

// ── Existing tests (baseline) ────────────────────────────────────────────────

test('keyword-only article gets baseline severity', () => {
  const score = computeCompositeSeverity({
    keywordSeverity: 85,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'Seismic'
  });
  assert.ok(score >= 25 && score <= 50);
});

test('multi-source diverse event scores higher than single source with crisis keyword', () => {
  const singleSource = computeCompositeSeverity({
    keywordSeverity: 85,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'General'
  });
  const multiSource = computeCompositeSeverity({
    keywordSeverity: 40,
    articleCount: 8,
    diversityScore: 0.8,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(multiSource > singleSource);
});

test('military entity boosts severity', () => {
  const withEntity = computeCompositeSeverity({
    keywordSeverity: 50,
    articleCount: 3,
    diversityScore: 0.5,
    entities: { organizations: [{ name: 'Wagner Group', type: 'military' }], people: [] },
    category: 'Conflict'
  });
  const without = computeCompositeSeverity({
    keywordSeverity: 50,
    articleCount: 3,
    diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(withEntity > without);
});

test('conflict/disaster categories score higher than political/economic', () => {
  const conflict = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'Conflict'
  });
  const economic = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'Economic'
  });
  assert.ok(conflict > economic);
});

test('NER categories also work (lowercase)', () => {
  const disaster = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'disaster'
  });
  const economic = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] }, category: 'economic'
  });
  assert.ok(disaster > economic);
});

test('returns clamped 0-100 range', () => {
  const low = computeCompositeSeverity({
    keywordSeverity: 0, articleCount: 1, diversityScore: 0,
    entities: { organizations: [], people: [] }, category: 'General'
  });
  const high = computeCompositeSeverity({
    keywordSeverity: 100, articleCount: 50, diversityScore: 1,
    entities: { organizations: [{ type: 'military' }, { type: 'military' }], people: [] },
    category: 'Conflict'
  });
  assert.ok(low >= 0 && low <= 100);
  assert.ok(high >= 0 && high <= 100);
});

// ── Entity significance tests ────────────────────────────────────────────────

test('head of state entity boosts severity', () => {
  const withLeader = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: {
      organizations: [],
      people: [{ name: 'President Biden' }]
    },
    category: 'Political'
  });
  const withoutLeader = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [{ name: 'John Smith' }] },
    category: 'Political'
  });
  assert.ok(withLeader > withoutLeader,
    `Head of state score (${withLeader}) should exceed generic person (${withoutLeader})`);
});

test('prime minister entity boosts severity', () => {
  const withPM = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: {
      organizations: [],
      people: [{ name: 'Prime Minister Modi' }]
    },
    category: 'Political'
  });
  const without = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Political'
  });
  assert.ok(withPM > without,
    `PM score (${withPM}) should exceed no-entity score (${without})`);
});

test('major international organization boosts severity', () => {
  const withUN = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: {
      organizations: [{ name: 'United Nations', type: 'international' }],
      people: []
    },
    category: 'Humanitarian'
  });
  const withLocal = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: {
      organizations: [{ name: 'Local NGO', type: 'ngo' }],
      people: []
    },
    category: 'Humanitarian'
  });
  assert.ok(withUN > withLocal,
    `UN score (${withUN}) should exceed local org score (${withLocal})`);
});

test('NATO involvement boosts severity', () => {
  const withNATO = computeCompositeSeverity({
    keywordSeverity: 60, articleCount: 4, diversityScore: 0.6,
    entities: {
      organizations: [{ name: 'NATO', type: 'military_alliance' }],
      people: []
    },
    category: 'Conflict'
  });
  const without = computeCompositeSeverity({
    keywordSeverity: 60, articleCount: 4, diversityScore: 0.6,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(withNATO > without,
    `NATO score (${withNATO}) should exceed no-entity score (${without})`);
});

test('multiple significant entities stack boost', () => {
  const multiSignificant = computeCompositeSeverity({
    keywordSeverity: 60, articleCount: 5, diversityScore: 0.7,
    entities: {
      organizations: [{ name: 'NATO', type: 'military_alliance' }],
      people: [{ name: 'President Zelensky' }]
    },
    category: 'Conflict'
  });
  const singleSignificant = computeCompositeSeverity({
    keywordSeverity: 60, articleCount: 5, diversityScore: 0.7,
    entities: {
      organizations: [],
      people: [{ name: 'President Zelensky' }]
    },
    category: 'Conflict'
  });
  assert.ok(multiSignificant > singleSignificant,
    `Multiple significant entities (${multiSignificant}) should exceed single (${singleSignificant})`);
});

// ── Geographic clustering (conflict zone) tests ──────────────────────────────

test('event in conflict zone gets severity boost', () => {
  const conflictZone = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'SY' // Syria
  });
  const peaceful = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'CH' // Switzerland
  });
  assert.ok(conflictZone > peaceful,
    `Conflict zone (Syria: ${conflictZone}) should exceed peaceful (Switzerland: ${peaceful})`);
});

test('Ukraine events get conflict zone boost', () => {
  const ukraine = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'UA'
  });
  const base = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(ukraine > base,
    `Ukraine score (${ukraine}) should exceed base score (${base})`);
});

test('tension zone gets smaller boost than conflict zone', () => {
  const conflictZone = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'SY' // Syria - active conflict
  });
  const tensionZone = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'IR' // Iran - tension zone
  });
  const peaceful = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    isoA2: 'CH' // Switzerland - no boost
  });
  assert.ok(conflictZone > tensionZone,
    `Conflict zone (${conflictZone}) should exceed tension zone (${tensionZone})`);
  assert.ok(tensionZone > peaceful,
    `Tension zone (${tensionZone}) should exceed peaceful (${peaceful})`);
});

test('no isoA2 still works (backward compatibility)', () => {
  const score = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(score >= 0 && score <= 100);
});

// ── Historical baseline comparison tests ─────────────────────────────────────

test('above-normal regional activity boosts severity', () => {
  const highActivity = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    regionalBaselineRatio: 3.0 // 3x normal activity
  });
  const normalActivity = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    regionalBaselineRatio: 1.0 // normal activity
  });
  assert.ok(highActivity > normalActivity,
    `High activity ratio (${highActivity}) should exceed normal (${normalActivity})`);
});

test('below-normal regional activity does not boost (or slightly reduces)', () => {
  const lowActivity = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    regionalBaselineRatio: 0.5 // below normal
  });
  const normalActivity = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict',
    regionalBaselineRatio: 1.0
  });
  assert.ok(lowActivity <= normalActivity,
    `Low activity (${lowActivity}) should not exceed normal (${normalActivity})`);
});

test('no regionalBaselineRatio still works (backward compatibility)', () => {
  const score = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 3, diversityScore: 0.5,
    entities: { organizations: [], people: [] },
    category: 'Conflict'
  });
  assert.ok(score >= 0 && score <= 100);
});

// ── Score differentiation tests ──────────────────────────────────────────────

test('different factor combinations produce meaningfully different scores', () => {
  const lowProfile = computeCompositeSeverity({
    keywordSeverity: 20, articleCount: 1, diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'Economic'
  });
  const midProfile = computeCompositeSeverity({
    keywordSeverity: 50, articleCount: 4, diversityScore: 0.5,
    entities: { organizations: [{ name: 'EU', type: 'international' }], people: [] },
    category: 'Political',
    isoA2: 'IR'
  });
  const highProfile = computeCompositeSeverity({
    keywordSeverity: 85, articleCount: 12, diversityScore: 0.9,
    entities: {
      organizations: [{ name: 'NATO', type: 'military_alliance' }],
      people: [{ name: 'President Zelensky' }]
    },
    category: 'Conflict',
    isoA2: 'UA',
    velocitySignal: 80,
    regionalBaselineRatio: 4.0
  });

  assert.ok(highProfile > midProfile,
    `High profile (${highProfile}) should exceed mid (${midProfile})`);
  assert.ok(midProfile > lowProfile,
    `Mid profile (${midProfile}) should exceed low (${lowProfile})`);
  assert.ok(highProfile - lowProfile >= 30,
    `Score spread should be at least 30 points (got ${highProfile - lowProfile})`);
});

test('all factors combined produces highest possible severity', () => {
  const maxScore = computeCompositeSeverity({
    keywordSeverity: 100,
    articleCount: 30,
    diversityScore: 1.0,
    entities: {
      organizations: [
        { name: 'NATO', type: 'military_alliance' },
        { name: 'Wagner Group', type: 'military' }
      ],
      people: [{ name: 'President Putin' }]
    },
    category: 'Conflict',
    isoA2: 'UA',
    velocitySignal: 100,
    regionalBaselineRatio: 5.0
  });
  assert.ok(maxScore >= 85,
    `Max combined score (${maxScore}) should be at least 85`);
  assert.ok(maxScore <= 100, `Score should be clamped at 100`);
});

test('minimal factors produce low severity', () => {
  const minScore = computeCompositeSeverity({
    keywordSeverity: 10,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'General',
    isoA2: 'CH',
    regionalBaselineRatio: 0.5
  });
  assert.ok(minScore <= 20,
    `Minimal score (${minScore}) should be at most 20`);
});

test('high-profile event (head of state + major conflict) scores significantly higher', () => {
  const highProfileConflict = computeCompositeSeverity({
    keywordSeverity: 80,
    articleCount: 10,
    diversityScore: 0.8,
    entities: {
      organizations: [{ name: 'United Nations Security Council', type: 'international' }],
      people: [{ name: 'President Zelensky' }, { name: 'Chancellor Scholz' }]
    },
    category: 'Conflict',
    isoA2: 'UA',
    velocitySignal: 60
  });
  const routineEvent = computeCompositeSeverity({
    keywordSeverity: 40,
    articleCount: 2,
    diversityScore: 0.2,
    entities: { organizations: [], people: [] },
    category: 'Political'
  });
  assert.ok(highProfileConflict > routineEvent + 25,
    `High-profile conflict (${highProfileConflict}) should exceed routine event (${routineEvent}) by 25+`);
});
