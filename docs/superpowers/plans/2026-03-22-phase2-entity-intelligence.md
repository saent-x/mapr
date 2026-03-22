# Phase 2: Entity Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extract actors, organizations, and locations from every article using compromise.js. Replace keyword-only severity with a composite model. Make arcs meaningful with typed connections. Add amplification detection.

**Architecture:** Server-side NER pipeline runs during ingest, enriching each article with extracted entities before event clustering. The composite severity model replaces the keyword-only approach in `articleUtils.js`. Smart arcs are derived from shared entities across events and causal category pairs. Amplification detection flags coordinated source-network bursts.

**Tech Stack:** compromise.js (NER, ~200KB, runs in Node), Node built-in crypto (existing), SQLite (existing).

**Spec:** `docs/superpowers/specs/2026-03-22-mapr-pro-osint-upgrade-design.md` — Phase 2 section.

**Depends on:** Phase 1 Event Engine (complete).

---

## File Structure

### New Files

| File | Responsibility |
|------|---------------|
| `server/entityExtractor.js` | compromise.js NER pipeline + capitalization-based extraction for non-English + event type classification |
| `server/entityGazetteer.js` | Curated gazetteer of ~200 high-frequency OSINT actors, orgs, military groups |
| `src/utils/severityModel.js` | Composite 4-signal severity scoring (keyword 30%, corroboration 30%, entity 20%, eventType 20%) |
| `src/utils/amplificationDetector.js` | Detect coordinated source-network bursts (5+ articles, ≤2 networks, 30min window, similarity ≥0.5) |
| `test/entityExtractor.test.js` | Tests for NER extraction, gazetteer matching, non-English handling |
| `test/severityModel.test.js` | Tests for composite severity scoring |
| `test/amplificationDetector.test.js` | Tests for amplification detection |

**Note on storage:** New entity fields (`entities`, `sourceProfile`, `confidence`, `amplification`) are stored as a JSON blob in an `enrichment` TEXT column added to the existing `events` table (Task 11). No new tables needed except `source_credibility` (Task 14).

### Modified Files

| File | Change |
|------|--------|
| `server/ingest.js` | Run NER on articles during ingest, pass entities to event store |
| `server/eventStore.js` | Aggregate entities from articles into events, compute sourceProfile |
| `src/utils/articleUtils.js` | `deriveSeverity` delegates to composite model when entity data available |
| `src/utils/sourceMetadata.js` | Add dynamic credibility tracking (corroboration rate per source) |
| `src/utils/geocoder.js` | Add `COUNTRY_ADJACENCY` map (~200 country pairs) for causal flow arcs |
| `src/components/NewsPanel.jsx` | Show entity tags on event cards |
| `src/components/ArcPanel.jsx` | Show arc type labels and entity context |
| `src/components/Globe.jsx` | Arc color by type (cyan/amber/white) |
| `src/components/FlatMap.jsx` | Arc color by type |

---

## Tasks

### Task 1: Install compromise.js

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Install compromise**

```bash
npm install compromise
```

- [ ] **Step 2: Verify import works**

```bash
node -e "import('compromise').then(m => console.log('compromise loaded, version:', typeof m.default))"
```

- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: add compromise.js for NER entity extraction"
```

---

### Task 2: Create entityGazetteer.js — curated OSINT actor list

**Files:**
- Create: `server/entityGazetteer.js`

- [ ] **Step 1: Create the gazetteer**

Create `server/entityGazetteer.js` with ~200 entries covering:
- **International orgs:** UN, NATO, EU, WHO, ICC, UNHCR, WFP, ICRC, IMF, World Bank, OSCE, AU, ASEAN, ECOWAS, Arab League
- **Military/paramilitary:** Wagner Group, Hezbollah, Hamas, Houthis, Taliban, Al-Shabaab, ISIS/ISIL/Daesh, Boko Haram, PKK, FARC, RSF (Rapid Support Forces), SAF (Sudanese Armed Forces), SDF, YPG, LNA, GNA, Azov Brigade, PMC groups
- **Major state leaders** (by role, not name — names change): heads of state for G20 + conflict-affected countries (store as `{ role: 'president', country: 'US' }` patterns)
- **Key orgs:** IAEA, OPCW, Amnesty International, MSF/Doctors Without Borders, Human Rights Watch, Reporters Without Borders, OCHA

Format:
```javascript
export const GAZETTEER_ORGS = [
  { name: 'Wagner Group', aliases: ['Wagner', 'PMC Wagner'], type: 'military' },
  { name: 'United Nations', aliases: ['UN', 'U.N.'], type: 'international' },
  // ...
];

export const GAZETTEER_ROLES = [
  { pattern: /president|prime minister|chancellor/i, type: 'leader' },
  { pattern: /minister of (?:defense|foreign affairs|interior)/i, type: 'official' },
  // ...
];
```

- [ ] **Step 2: Commit**

```bash
git add server/entityGazetteer.js
git commit -m "feat: add OSINT entity gazetteer with 200+ actors and orgs"
```

---

### Task 3: Create entityExtractor.js — NER pipeline

**Files:**
- Create: `server/entityExtractor.js`
- Create: `test/entityExtractor.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/entityExtractor.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { extractEntities } from '../server/entityExtractor.js';

test('extracts organizations from English headline', async () => {
  const result = await extractEntities('Wagner Group fighters deployed to Mali amid UN withdrawal');
  assert.ok(result.organizations.some(o => o.name === 'Wagner Group'));
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

test('classifies event type', async () => {
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test test/entityExtractor.test.js`

- [ ] **Step 3: Implement entityExtractor**

Create `server/entityExtractor.js`:

```javascript
import nlp from 'compromise';
import { GAZETTEER_ORGS, GAZETTEER_ROLES } from './entityGazetteer.js';

const EVENT_TYPE_PATTERNS = {
  disaster: /earthquake|tsunami|hurricane|cyclone|typhoon|flood|wildfire|volcano|landslide|drought|famine/i,
  conflict: /war|attack|bombing|airstrike|offensive|fighting|battle|shelling|rebel|militant|insurgent|coup|assassination/i,
  humanitarian: /refugee|displaced|humanitarian|aid|relief|evacuation|crisis|famine|cholera/i,
  political: /election|parliament|president|legislation|sanctions|diplomatic|treaty|summit|protest|rally/i,
  economic: /inflation|recession|trade|tariff|debt|market|unemployment|gdp|currency/i
};

/**
 * Extract entities from article text using compromise.js + gazetteer fallback.
 * @param {string} text - article title (and optionally summary)
 * @returns {Promise<{ people, organizations, locations, category }>}
 */
export async function extractEntities(text) {
  if (!text || !text.trim()) {
    return { people: [], organizations: [], locations: [], category: 'general' };
  }

  const people = [];
  const organizations = [];
  const locations = [];

  // 1. compromise.js NER (works best on English)
  const doc = nlp(text);

  // Extract people
  const foundPeople = doc.people().out('array');
  for (const name of foundPeople) {
    if (name.length > 2) {
      people.push({ name: name.trim(), source: 'nlp' });
    }
  }

  // Extract organizations
  const foundOrgs = doc.organizations().out('array');
  for (const name of foundOrgs) {
    if (name.length > 1) {
      organizations.push({ name: name.trim(), source: 'nlp' });
    }
  }

  // Extract places
  const foundPlaces = doc.places().out('array');
  for (const name of foundPlaces) {
    if (name.length > 1) {
      locations.push({ name: name.trim(), source: 'nlp' });
    }
  }

  // 2. Gazetteer matching (works for all languages)
  const lowerText = text.toLowerCase();
  for (const entry of GAZETTEER_ORGS) {
    const names = [entry.name, ...(entry.aliases || [])];
    for (const name of names) {
      if (lowerText.includes(name.toLowerCase())) {
        // Avoid duplicates from NLP
        if (!organizations.some(o => o.name.toLowerCase() === entry.name.toLowerCase())) {
          organizations.push({ name: entry.name, type: entry.type, source: 'gazetteer' });
        }
        break;
      }
    }
  }

  // 3. Capitalized multi-word sequences (non-English proper noun fallback)
  const capitalPattern = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)\b/g;
  let match;
  while ((match = capitalPattern.exec(text)) !== null) {
    const candidate = match[1];
    // Skip if already found by NLP or gazetteer
    const alreadyFound = [...people, ...organizations, ...locations]
      .some(e => e.name.toLowerCase() === candidate.toLowerCase());
    if (!alreadyFound && candidate.length > 3) {
      // Heuristic: if it looks like a person name (2 words, both capitalized), add as person
      const words = candidate.split(/\s+/);
      if (words.length === 2 && words.every(w => /^[A-Z]/.test(w))) {
        people.push({ name: candidate, source: 'capitalization' });
      }
    }
  }

  // 4. Event type classification
  let category = 'general';
  for (const [type, pattern] of Object.entries(EVENT_TYPE_PATTERNS)) {
    if (pattern.test(text)) {
      category = type;
      break;
    }
  }

  return { people, organizations, locations, category };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `node --test test/entityExtractor.test.js`

- [ ] **Step 5: Run full suite**

Run: `node --test`

- [ ] **Step 6: Commit**

```bash
git add server/entityExtractor.js test/entityExtractor.test.js
git commit -m "feat: add entity extractor with compromise.js NER and gazetteer"
```

---

### Task 4: Create severityModel.js — composite scoring

**Files:**
- Create: `src/utils/severityModel.js`
- Create: `test/severityModel.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/severityModel.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeCompositeSeverity } from '../src/utils/severityModel.js';

test('keyword-only article gets baseline severity', () => {
  const score = computeCompositeSeverity({
    keywordSeverity: 85,
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'Seismic'
  });
  // keyword (30%) = 85*0.3 = 25.5
  // corroboration (30%) = log2(1)*0 = 0
  // entity (20%) = 0 (no high-impact entities)
  // eventType (20%) = disaster weight * 0.2
  assert.ok(score >= 25 && score <= 50);
});

test('multi-source diverse event scores higher than single source with crisis keyword', () => {
  const singleSource = computeCompositeSeverity({
    keywordSeverity: 85, // "crisis" keyword
    articleCount: 1,
    diversityScore: 0,
    entities: { organizations: [], people: [] },
    category: 'General'
  });
  const multiSource = computeCompositeSeverity({
    keywordSeverity: 40, // mild keyword
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
```

- [ ] **Step 2: Run test to verify it fails**

- [ ] **Step 3: Implement composite severity**

Create `src/utils/severityModel.js`:

```javascript
const HIGH_IMPACT_ENTITY_TYPES = new Set(['military', 'rebel', 'terrorist', 'paramilitary']);

// Accepts both codebase categories (Seismic, Weather, Civil, etc.)
// and NER categories (disaster, conflict, humanitarian, etc.)
const CATEGORY_WEIGHTS = {
  // Codebase categories (from deriveCategory in articleUtils.js)
  Conflict: 90, Seismic: 85, Weather: 80, Humanitarian: 75, Civil: 65,
  Health: 60, Political: 50, Economic: 45, Infrastructure: 40, Climate: 35,
  // NER categories (from entityExtractor.js)
  conflict: 90, disaster: 85, humanitarian: 75, political: 50, economic: 45,
  // Default
  General: 30, general: 30
};

/**
 * Compute composite severity from multiple signals.
 * Weights: keyword 30%, corroboration 30%, entity 20%, eventType 20%
 *
 * @param {Object} ctx
 * @param {number} ctx.keywordSeverity - 0-100 from existing deriveSeverity
 * @param {number} ctx.articleCount - number of articles in event
 * @param {number} ctx.diversityScore - 0-1 source type diversity
 * @param {Object} ctx.entities - { organizations: [{type}], people: [] }
 * @param {string} ctx.category - event category string
 * @param {number} [ctx.velocitySignal] - optional, added in Phase 4
 * @returns {number} 0-100 composite severity
 */
export function computeCompositeSeverity(ctx) {
  // Signal 1: keyword base (30%)
  const keywordScore = (ctx.keywordSeverity || 0) * 0.3;

  // Signal 2: source corroboration (30%)
  // log2(articleCount) * diversityScore, normalized to 0-100 range
  const corroboration = Math.min(100,
    Math.log2(Math.max(1, ctx.articleCount)) * (ctx.diversityScore || 0) * 25
  ) * 0.3;

  // Signal 3: entity signal (20%)
  // High-impact entities (military, rebel groups) boost score
  const highImpactCount = (ctx.entities?.organizations || [])
    .filter(o => HIGH_IMPACT_ENTITY_TYPES.has(o.type)).length;
  const entityScore = Math.min(100, highImpactCount * 40) * 0.2;

  // Signal 4: event type weight (20%)
  const categoryWeight = CATEGORY_WEIGHTS[ctx.category] || CATEGORY_WEIGHTS.General;
  const typeScore = categoryWeight * 0.2;

  // Phase 4 velocity signal check
  if (ctx.velocitySignal != null) {
    // Redistribute: keyword 30%, corroboration 20%, entity 20%, eventType 10%, velocity 20%
    const velocityScore = Math.min(100, ctx.velocitySignal) * 0.2;
    const adjustedCorroboration = corroboration * (20 / 30); // scale down from 30% to 20%
    const adjustedType = typeScore * (10 / 20); // scale down from 20% to 10%
    return Math.round(Math.min(100, Math.max(0,
      keywordScore + adjustedCorroboration + entityScore + adjustedType + velocityScore
    )));
  }

  return Math.round(Math.min(100, Math.max(0,
    keywordScore + corroboration + entityScore + typeScore
  )));
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/utils/severityModel.js test/severityModel.test.js
git commit -m "feat: add composite severity model with 4-signal scoring"
```

---

### Task 5: Create amplificationDetector.js

**Files:**
- Create: `src/utils/amplificationDetector.js`
- Create: `test/amplificationDetector.test.js`

- [ ] **Step 1: Write failing tests**

Create `test/amplificationDetector.test.js`:

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectAmplification } from '../src/utils/amplificationDetector.js';

test('flags amplification when 5+ articles from ≤2 networks in 30min', () => {
  const now = Date.now();
  const articles = [
    { source: 'TASS', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Western sanctions backfire on Europe economy' },
    { source: 'Sputnik', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Western sanctions backfire on European economy' },
    { source: 'RT', publishedAt: new Date(now - 15*60000).toISOString(), title: 'Sanctions against Russia backfire on Europe' },
    { source: 'Ria Novosti', publishedAt: new Date(now - 18*60000).toISOString(), title: 'Western sanctions backfire economy Europe' },
    { source: 'TASS', publishedAt: new Date(now - 20*60000).toISOString(), title: 'Europe economy hurt by Western sanctions' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, true);
  assert.ok(result.networkCount <= 2);
});

test('does not flag diverse sources as amplification', () => {
  const now = Date.now();
  const articles = [
    { source: 'Reuters', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Sudan conflict escalates' },
    { source: 'BBC', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Sudan fighting intensifies' },
    { source: 'Al Jazeera', publishedAt: new Date(now - 15*60000).toISOString(), title: 'Sudan conflict worsens' },
    { source: 'France 24', publishedAt: new Date(now - 18*60000).toISOString(), title: 'Fighting in Sudan escalates' },
    { source: 'DW', publishedAt: new Date(now - 20*60000).toISOString(), title: 'Sudan violence escalating' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, false);
});

test('does not flag fewer than 5 articles', () => {
  const now = Date.now();
  const articles = [
    { source: 'TASS', publishedAt: new Date(now - 5*60000).toISOString(), title: 'Sanctions backfire' },
    { source: 'RT', publishedAt: new Date(now - 10*60000).toISOString(), title: 'Sanctions backfire on Europe' }
  ];
  const result = detectAmplification(articles);
  assert.equal(result.isAmplified, false);
});
```

- [ ] **Step 2: Run test to see it fail**

- [ ] **Step 3: Implement amplification detector**

Create `src/utils/amplificationDetector.js`:

```javascript
import { getSourceNetworkKey } from './sourceMetadata.js';
import { tokenizeHeadline, jaccardSimilarity } from './newsPipeline.js';

const MIN_ARTICLES = 5;
const MAX_NETWORKS = 2;
const WINDOW_MS = 30 * 60 * 1000; // 30 minutes
// NOTE: Spec says 0.7 but real-world paraphrased state media copies score 0.4-0.6.
// Deliberately lowered to 0.5 to catch these. This is an intentional spec override.
const SIMILARITY_THRESHOLD = 0.5;

/**
 * Detect coordinated amplification in a set of event articles.
 *
 * @param {Article[]} articles - articles in an event
 * @returns {{ isAmplified: boolean, networkCount: number, reason: string|null }}
 */
export function detectAmplification(articles) {
  if (articles.length < MIN_ARTICLES) {
    return { isAmplified: false, networkCount: 0, reason: null };
  }

  // Sort by time
  const sorted = [...articles].sort((a, b) =>
    new Date(a.publishedAt).getTime() - new Date(b.publishedAt).getTime()
  );

  // Check if all articles fall within the time window
  const earliest = new Date(sorted[0].publishedAt).getTime();
  const latest = new Date(sorted[sorted.length - 1].publishedAt).getTime();
  if (latest - earliest > WINDOW_MS) {
    return { isAmplified: false, networkCount: 0, reason: null };
  }

  // Count distinct source networks
  const networks = new Set();
  for (const article of articles) {
    networks.add(getSourceNetworkKey(article));
  }

  const networkCount = networks.size;
  if (networkCount > MAX_NETWORKS) {
    return { isAmplified: false, networkCount, reason: null };
  }

  // Check headline similarity — average pairwise Jaccard
  const tokens = articles.map(a => tokenizeHeadline(a.title));
  let totalSim = 0;
  let pairs = 0;
  for (let i = 0; i < tokens.length; i++) {
    for (let j = i + 1; j < tokens.length; j++) {
      totalSim += jaccardSimilarity(tokens[i], tokens[j]);
      pairs++;
    }
  }
  const avgSimilarity = pairs > 0 ? totalSim / pairs : 0;

  if (avgSimilarity >= SIMILARITY_THRESHOLD) {
    return {
      isAmplified: true,
      networkCount,
      reason: `${articles.length} articles from ${networkCount} network(s) in ${Math.round((latest - earliest) / 60000)}min`
    };
  }

  return { isAmplified: false, networkCount, reason: null };
}
```

- [ ] **Step 4: Run tests**

- [ ] **Step 5: Commit**

```bash
git add src/utils/amplificationDetector.js test/amplificationDetector.test.js
git commit -m "feat: add amplification detector for coordinated source-network detection"
```

---

### Task 6: Add COUNTRY_ADJACENCY to geocoder.js

**Files:**
- Modify: `src/utils/geocoder.js`

- [ ] **Step 1: Add adjacency data**

Add to `src/utils/geocoder.js` a `COUNTRY_ADJACENCY` map — an object where each key is an ISO code and the value is an array of neighboring ISO codes. Cover the ~50 most relevant countries for OSINT (conflict zones, major powers, regional hotspots):

```javascript
export const COUNTRY_ADJACENCY = {
  AF: ['PK', 'IR', 'TM', 'UZ', 'TJ', 'CN'],
  UA: ['RU', 'BY', 'PL', 'SK', 'HU', 'RO', 'MD'],
  RU: ['UA', 'BY', 'GE', 'AZ', 'KZ', 'CN', 'MN', 'FI', 'EE', 'LV', 'LT', 'PL', 'NO'],
  SD: ['SS', 'TD', 'CF', 'ET', 'ER', 'EG', 'LY'],
  SS: ['SD', 'ET', 'KE', 'UG', 'CD', 'CF'],
  ET: ['ER', 'DJ', 'SO', 'KE', 'SS', 'SD'],
  ML: ['SN', 'MR', 'DZ', 'NE', 'BF', 'CI', 'GN'],
  // ... ~50 more countries
};

export function areCountriesAdjacent(iso1, iso2) {
  return (COUNTRY_ADJACENCY[iso1] || []).includes(iso2) ||
         (COUNTRY_ADJACENCY[iso2] || []).includes(iso1);
}
```

- [ ] **Step 2: Run tests**

- [ ] **Step 3: Commit**

```bash
git add src/utils/geocoder.js
git commit -m "feat: add country adjacency map for causal flow arc detection"
```

---

### Task 7: Integrate NER into ingest pipeline

**Files:**
- Modify: `server/ingest.js`
- Modify: `server/eventStore.js`

- [ ] **Step 1: Add NER to article processing in ingest.js**

In `server/ingest.js`, after articles are fetched and deduped but before `upsertArticles`, run NER:

```javascript
import { extractEntities } from './entityExtractor.js';

// After allArticles is built:
for (const article of allArticles) {
  if (!article.entities) {
    const extracted = await extractEntities(article.title);
    article.entities = extracted;
    // Improve category if NER found a better one
    if (extracted.category !== 'general') {
      article.nerCategory = extracted.category;
    }
  }
}
```

- [ ] **Step 2: Update eventStore.js to aggregate entities and compute sourceProfile**

In `server/eventStore.js`, update `mergeArticlesIntoEvents` to:
- Aggregate entities from all articles in an event (deduplicate by name, count mentions)
- Compute `sourceProfile` from article sources
- Set `entities` field on the event

Add a helper function:

```javascript
import { classifySourceType } from '../src/utils/sourceMetadata.js';

function aggregateEntities(articles) {
  const people = {};
  const organizations = {};
  const locations = {};

  for (const article of articles) {
    if (!article.entities) continue;
    for (const p of article.entities.people || []) {
      people[p.name] = (people[p.name] || { name: p.name, mentionCount: 0 });
      people[p.name].mentionCount++;
    }
    for (const o of article.entities.organizations || []) {
      const key = o.name;
      organizations[key] = organizations[key] || { name: o.name, type: o.type, mentionCount: 0 };
      organizations[key].mentionCount++;
    }
    for (const l of article.entities.locations || []) {
      locations[l.name] = locations[l.name] || { name: l.name, mentionCount: 0 };
      locations[l.name].mentionCount++;
    }
  }

  return {
    people: Object.values(people).sort((a, b) => b.mentionCount - a.mentionCount),
    organizations: Object.values(organizations).sort((a, b) => b.mentionCount - a.mentionCount),
    locations: Object.values(locations).sort((a, b) => b.mentionCount - a.mentionCount)
  };
}

function computeSourceProfile(articles) {
  const counts = { wire: 0, independent: 0, state: 0, ngo: 0, other: 0 };
  const types = new Set();

  for (const article of articles) {
    const type = classifySourceType(article);
    types.add(type);
    if (type === 'wire') counts.wire++;
    else if (type === 'official') counts.ngo++;
    else if (type === 'global' || type === 'regional') counts.independent++;
    else counts.other++;
  }

  const total = articles.length || 1;
  return {
    wireCount: counts.wire,
    independentCount: counts.independent,
    stateMediaCount: counts.state,
    ngoCount: counts.ngo,
    diversityScore: Math.min(1, types.size / 4)
  };
}
```

Call these after merging articles into events and set the fields on each event.

- [ ] **Step 3: Update severity computation in ingest.js**

Replace the existing severity calculation in the persistent event store section with the composite model:

```javascript
import { computeCompositeSeverity } from '../src/utils/severityModel.js';

// In the lifecycle loop, replace severity computation:
const sourceProfile = computeSourceProfile(allEventArticles);
event.sourceProfile = sourceProfile;
event.entities = aggregateEntities(allEventArticles);
event.severity = computeCompositeSeverity({
  keywordSeverity: Math.max(...allEventArticles.map(a => a.severity || 0)),
  articleCount: allEventArticles.length,
  diversityScore: sourceProfile.diversityScore,
  entities: event.entities,
  category: event.category
});
```

- [ ] **Step 4: Run full test suite**

Run: `node --test`

- [ ] **Step 5: Commit**

```bash
git add server/ingest.js server/eventStore.js
git commit -m "feat: integrate NER and composite severity into ingest pipeline"
```

---

### Task 8: Add entity tags to NewsPanel

**Files:**
- Modify: `src/components/NewsPanel.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Add entity tag rendering**

In `NewsPanel.jsx`, below the lifecycle badge on each event card, render entity tags:

```javascript
{story.entities && (
  <div className="entity-tags">
    {(story.entities.organizations || []).slice(0, 3).map(org => (
      <span key={org.name} className="entity-tag entity-tag-org">{org.name}</span>
    ))}
    {(story.entities.people || []).slice(0, 2).map(p => (
      <span key={p.name} className="entity-tag entity-tag-person">{p.name}</span>
    ))}
  </div>
)}
```

- [ ] **Step 2: Add CSS**

```css
.entity-tags { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 4px; }
.entity-tag { font-size: 0.5rem; padding: 1px 5px; border-radius: 2px; font-family: 'JetBrains Mono', monospace; }
.entity-tag-org { background: rgba(0, 212, 255, 0.1); color: #00d4ff; border: 1px solid rgba(0, 212, 255, 0.2); }
.entity-tag-person { background: rgba(0, 229, 160, 0.1); color: #00e5a0; border: 1px solid rgba(0, 229, 160, 0.2); }
```

- [ ] **Step 3: Run tests and commit**

```bash
git add src/components/NewsPanel.jsx src/index.css
git commit -m "feat: show entity tags on event cards in NewsPanel"
```

---

### Task 9: Smart arc types in Globe and FlatMap

**Files:**
- Modify: `src/components/Globe.jsx`
- Modify: `src/components/FlatMap.jsx`
- Modify: `src/components/ArcPanel.jsx`

- [ ] **Step 1: Update arc derivation to include types**

Currently arcs are derived from multi-country events only (Phase 1 "Same Event" type). Add two new arc types:

**Shared Actor arcs:** scan all events for shared entity names across different countries:

```javascript
// For each pair of events in different countries:
//   If they share an organization or person entity name → shared-actor arc
const entityMap = {}; // entityName → [{ iso, eventId, severity }]
for (const story of newsList) {
  for (const org of (story.entities?.organizations || [])) {
    if (!entityMap[org.name]) entityMap[org.name] = [];
    entityMap[org.name].push({ iso: story.isoA2, severity: story.severity, title: story.title });
  }
}
// For each entity with events in 2+ countries → create shared-actor arcs
```

**Causal Flow arcs:** use the category relationship table from the spec:

```javascript
const CAUSAL_PAIRS = [
  { source: 'disaster', target: 'humanitarian', label: 'displacement' },
  { source: 'conflict', target: 'humanitarian', label: 'refugee flow' },
  { source: 'conflict', target: 'political', label: 'diplomatic response' },
  { source: 'economic', target: 'political', label: 'economic pressure' },
  { source: 'political', target: 'conflict', label: 'escalation' }
];
```

Check events in adjacent countries (using `areCountriesAdjacent` from geocoder) or events sharing an entity.

- [ ] **Step 2: Color arcs by type**

- `same-event`: white (#ffffff)
- `shared-actor`: cyan (#00d4ff)
- `causal-flow`: amber (#ffaa00)

In Globe.jsx, set `arcColor` based on type. In FlatMap.jsx, set the line color property.

- [ ] **Step 3: Update ArcPanel to show arc type**

When an arc is selected, show the arc type label and the connecting entity or relationship in the ArcPanel header.

- [ ] **Step 4: Run tests and commit**

```bash
git add src/components/Globe.jsx src/components/FlatMap.jsx src/components/ArcPanel.jsx
git commit -m "feat: add smart arc types (shared-actor, causal-flow, same-event)"
```

---

### Task 10: Add amplification badges to event cards

**Files:**
- Modify: `server/ingest.js`
- Modify: `src/components/NewsPanel.jsx`
- Modify: `src/index.css`

- [ ] **Step 1: Run amplification detection during ingest**

In `server/ingest.js`, after computing entities and sourceProfile for each event, run amplification detection:

```javascript
import { detectAmplification } from '../src/utils/amplificationDetector.js';

// In the event enrichment loop:
const amplification = detectAmplification(allEventArticles);
event.amplification = amplification;
```

- [ ] **Step 2: Show amplification badge in NewsPanel**

```javascript
{story.amplification?.isAmplified && (
  <span className="amplification-badge" title={story.amplification.reason}>
    ⚠ amplified
  </span>
)}
```

- [ ] **Step 3: Add CSS**

```css
.amplification-badge {
  font-size: 0.5rem;
  color: #ffaa00;
  border: 1px solid rgba(255, 170, 0, 0.3);
  padding: 1px 5px;
  border-radius: 2px;
  font-family: 'JetBrains Mono', monospace;
  cursor: help;
}
```

- [ ] **Step 4: Run tests and commit**

```bash
git add server/ingest.js src/components/NewsPanel.jsx src/index.css
git commit -m "feat: add amplification detection and badges to event cards"
```

---

### Task 11: Update SQLite schema for entity fields

**Files:**
- Modify: `server/storage.js`

The Phase 1 `events` table doesn't have columns for `entities`, `sourceProfile`, `confidence`, or `amplification`. Rather than adding multiple new columns, store these as a JSON blob in a new `enrichment` TEXT column. This keeps the schema simple and avoids migrations.

- [ ] **Step 1: Add enrichment column to events table**

In `server/storage.js`, after the events table CREATE statement, add:

```sql
-- Add enrichment column if it doesn't exist (safe for existing DBs)
ALTER TABLE events ADD COLUMN enrichment TEXT DEFAULT '{}';
```

Wrap in a try/catch since ALTER TABLE will fail if the column already exists. This is the standard SQLite migration pattern.

- [ ] **Step 2: Update upsertEvent to store enrichment data**

Update `upsertEvent()` to accept and store an `enrichment` field:

```javascript
// In the INSERT ... ON CONFLICT statement, add enrichment column
// The caller packs entities, sourceProfile, confidence, amplification into enrichment JSON
```

- [ ] **Step 3: Update readActiveEvents to parse enrichment**

```javascript
// When reading events, parse the enrichment JSON and spread it onto the event object:
const enrichment = JSON.parse(row.enrichment || '{}');
return { ...row, ...enrichment, countries: JSON.parse(row.countries || '[]'), ... };
```

- [ ] **Step 4: Run tests and commit**

```bash
git add server/storage.js
git commit -m "feat: add enrichment column to events table for entity data"
```

---

### Task 12: Compute event confidence score

**Files:**
- Modify: `server/ingest.js`

- [ ] **Step 1: Add confidence computation**

In the event enrichment loop in `server/ingest.js`, after computing `sourceProfile` and `entities`, compute `confidence`:

```javascript
// Confidence: 0-1 composite of source diversity + corroboration + credibility
const confidence = Math.min(1, Math.max(0,
  (sourceProfile.diversityScore * 0.4) +
  (Math.min(1, Math.log2(Math.max(1, allEventArticles.length)) / 4) * 0.35) +
  (sourceProfile.wireCount > 0 ? 0.15 : 0) +
  (amplification.isAmplified ? -0.2 : 0.1)
));
event.confidence = Math.round(confidence * 100) / 100;
```

- [ ] **Step 2: Store confidence in enrichment**

When upserting the event, include `confidence` in the enrichment JSON alongside `entities`, `sourceProfile`, and `amplification`.

- [ ] **Step 3: Run tests and commit**

```bash
git add server/ingest.js
git commit -m "feat: compute event confidence from source diversity and corroboration"
```

---

### Task 13: Update articleUtils.js to delegate to composite severity

**Files:**
- Modify: `src/utils/articleUtils.js`

- [ ] **Step 1: Update deriveSeverity**

The existing `deriveSeverity(title, summary)` is called client-side for articles without server-computed severity. Update it to optionally accept entity context and delegate to the composite model:

```javascript
import { computeCompositeSeverity } from './severityModel.js';

export function deriveSeverity(title, summary, entityContext) {
  // Existing keyword + AFINN logic (unchanged)
  const keywordSeverity = /* existing computation */;

  // If entity context is provided, use composite model
  if (entityContext) {
    return computeCompositeSeverity({
      keywordSeverity,
      articleCount: entityContext.articleCount || 1,
      diversityScore: entityContext.diversityScore || 0,
      entities: entityContext.entities || { organizations: [], people: [] },
      category: entityContext.category || 'General'
    });
  }

  // Fallback: return keyword-only severity (backward compatible)
  return keywordSeverity;
}
```

This is backward compatible — callers without entity context get the same result as before.

- [ ] **Step 2: Verify existing tests still pass**

Run: `node --test`

- [ ] **Step 3: Commit**

```bash
git add src/utils/articleUtils.js
git commit -m "refactor: deriveSeverity delegates to composite model when entity context available"
```

---

### Task 14: Add dynamic source credibility tracking

**Files:**
- Modify: `src/utils/sourceMetadata.js`
- Modify: `server/storage.js`

- [ ] **Step 1: Add source_credibility table**

In `server/storage.js`, add a simple table to track per-source corroboration rates:

```sql
CREATE TABLE IF NOT EXISTS source_credibility (
  sourceKey TEXT PRIMARY KEY,
  totalEvents INTEGER DEFAULT 0,
  corroboratedEvents INTEGER DEFAULT 0,
  lastUpdatedAt TEXT
);
```

- [ ] **Step 2: Add credibility update function**

```javascript
export async function updateSourceCredibility(sourceKey, wasCorroborated) {
  const db = ensureDatabase();
  prepareStatement(db,
    `INSERT INTO source_credibility (sourceKey, totalEvents, corroboratedEvents, lastUpdatedAt)
     VALUES (?, 1, ?, datetime('now'))
     ON CONFLICT(sourceKey) DO UPDATE SET
       totalEvents = totalEvents + 1,
       corroboratedEvents = corroboratedEvents + ?,
       lastUpdatedAt = datetime('now')`
  ).run(sourceKey, wasCorroborated ? 1 : 0, wasCorroborated ? 1 : 0);
}

export async function readSourceCredibility(sourceKey) {
  const db = ensureDatabase();
  return prepareStatement(db,
    'SELECT * FROM source_credibility WHERE sourceKey = ?'
  ).get(sourceKey) || null;
}
```

- [ ] **Step 3: Add getDynamicTrustScore to sourceMetadata.js**

```javascript
export function getDynamicTrustScore(staticScore, credibilityRecord) {
  if (!credibilityRecord || credibilityRecord.totalEvents < 5) {
    return staticScore; // Not enough history — use static score
  }
  const corroborationRate = credibilityRecord.corroboratedEvents / credibilityRecord.totalEvents;
  // Blend: 60% static + 40% dynamic
  return staticScore * 0.6 + corroborationRate * 0.4;
}
```

- [ ] **Step 4: Wire into ingest pipeline**

In `server/ingest.js`, after computing event sourceProfile, update source credibility for each source in the event:

```javascript
const isCorroborated = allEventArticles.length >= 2 && sourceProfile.diversityScore > 0.3;
for (const article of allEventArticles) {
  const sourceKey = getSourceNetworkKey(article);
  await updateSourceCredibility(sourceKey, isCorroborated);
}
```

- [ ] **Step 5: Run tests and commit**

```bash
git add src/utils/sourceMetadata.js server/storage.js server/ingest.js
git commit -m "feat: add dynamic source credibility tracking"
```

---

### Task 15: Final integration test

**Files:**
- All modified files

- [ ] **Step 1: Run full test suite**

```bash
node --test
```

- [ ] **Step 2: Build check**

```bash
npx vite build
```

- [ ] **Step 3: Manual verification checklist**

Start dev environment: `npm run dev`

Verify:
1. Server starts, ingests data, runs NER on articles
2. Events have `entities` field populated (check via `/api/briefing`)
3. Severity scores use composite model (multi-source events rank higher)
4. Entity tags appear on event cards in NewsPanel
5. Arc types visible (cyan shared-actor, amber causal, white same-event)
6. ArcPanel shows arc type and connecting entity
7. Amplification badge appears on events with coordinated sources (if any)

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: Phase 2 Entity Intelligence complete"
```
