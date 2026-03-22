# Phase 4: Coverage Intelligence — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface what you're NOT seeing and what's suspicious. Silence map, velocity anomalies, region confidence, source health promotion.

**Architecture:** Server-side velocity tracking during ingest. Client-side silence detection and region confidence computation from existing coverage data. New "coverage" map overlay mode alongside existing "severity" overlay.

**Tech Stack:** No new dependencies. Builds on existing `coverageHistory.js`, `coverageDiagnostics.js`, `sourceMetadata.js`.

**Spec:** `docs/superpowers/specs/2026-03-22-mapr-pro-osint-upgrade-design.md` — Phase 4 section.

---

## Tasks

### Task 1: Create velocityTracker.js — server-side anomaly detection

**Files:**
- Create: `server/velocityTracker.js`
- Create: `test/velocityTracker.test.js`

- [ ] **Step 1: Write tests**

```javascript
import test from 'node:test';
import assert from 'node:assert/strict';
import { computeVelocitySpikes, computeZScore } from '../server/velocityTracker.js';

test('computeZScore returns 0 for no history', () => {
  assert.equal(computeZScore(5, []), 0);
});

test('computeZScore detects spike above 2 stddev', () => {
  const history = [2, 3, 2, 3, 2, 3, 2]; // mean ~2.4, low variance
  const z = computeZScore(10, history); // way above normal
  assert.ok(z >= 2.0);
});

test('computeVelocitySpikes flags regions with velocity spikes', () => {
  const regionHistory = {
    'NG': { counts: [2, 3, 2, 3, 2, 3, 2], currentCount: 12 },
    'US': { counts: [10, 12, 11, 10, 12, 11, 10], currentCount: 11 }
  };
  const spikes = computeVelocitySpikes(regionHistory);
  assert.ok(spikes.some(s => s.iso === 'NG' && s.level === 'spike'));
  assert.ok(!spikes.some(s => s.iso === 'US'));
});
```

- [ ] **Step 2: Implement velocityTracker.js**

```javascript
export function computeZScore(current, history) {
  if (!history.length) return 0;
  const mean = history.reduce((s, v) => s + v, 0) / history.length;
  const variance = history.reduce((s, v) => s + (v - mean) ** 2, 0) / history.length;
  const stddev = Math.sqrt(variance);
  if (stddev === 0) return current > mean ? 3 : 0;
  return (current - mean) / stddev;
}

export function computeVelocitySpikes(regionHistory) {
  const spikes = [];
  for (const [iso, data] of Object.entries(regionHistory)) {
    const z = computeZScore(data.currentCount, data.counts);
    if (z >= 2.0) spikes.push({ iso, zScore: z, level: 'spike', currentCount: data.currentCount });
    else if (z >= 1.5) spikes.push({ iso, zScore: z, level: 'elevated', currentCount: data.currentCount });
  }
  return spikes.sort((a, b) => b.zScore - a.zScore);
}
```

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add velocity tracker with z-score anomaly detection"
```

---

### Task 2: Create silenceDetector.js

**Files:**
- Create: `src/utils/silenceDetector.js`
- Create: `test/silenceDetector.test.js`

- [ ] **Step 1: Write tests**

```javascript
test('flags anomalous silence when current < 30% of average', () => {
  const result = detectSilence({ iso: 'NG', currentCount: 1, rollingAverage: 10 });
  assert.equal(result.status, 'anomalous-silence');
});

test('flags blind spot when zero sources and GDELT active', () => {
  const result = detectSilence({ iso: 'ER', currentCount: 0, rollingAverage: 0, gdeltActive: true });
  assert.equal(result.status, 'blind-spot');
});

test('flags limited access for known restricted countries', () => {
  const result = detectSilence({ iso: 'KP', currentCount: 0, rollingAverage: 0 });
  assert.equal(result.status, 'limited-access');
});

test('returns covered for normal activity', () => {
  const result = detectSilence({ iso: 'US', currentCount: 15, rollingAverage: 12 });
  assert.equal(result.status, 'covered');
});
```

- [ ] **Step 2: Implement**

Known restricted countries: KP, TM, ER (configurable list). Thresholds: <30% of rolling average = anomalous silence.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add silence detector for coverage blindspot alerting"
```

---

### Task 3: Create regionConfidence.js

**Files:**
- Create: `src/utils/regionConfidence.js`
- Create: `test/regionConfidence.test.js`

- [ ] **Step 1: Write tests**

```javascript
test('high confidence for well-covered region', () => {
  const score = computeRegionConfidence({ sourceCount: 8, sourceDiversity: 0.8, recencyHours: 1, geocodePrecision: 'locality' });
  assert.ok(score >= 0.7);
});

test('low confidence for sparse region', () => {
  const score = computeRegionConfidence({ sourceCount: 1, sourceDiversity: 0.1, recencyHours: 48, geocodePrecision: 'country' });
  assert.ok(score <= 0.3);
});
```

- [ ] **Step 2: Implement**

Weights: sourceCount 30%, sourceDiversity 25%, recency 25%, geocodePrecision 20%. Returns 0-1.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: add region confidence scoring"
```

---

### Task 4: Integrate velocity tracking into ingest

**Files:**
- Modify: `server/ingest.js`
- Modify: `server/storage.js`

- [ ] **Step 1: Add velocity history table**

In storage.js:
```sql
CREATE TABLE IF NOT EXISTS velocity_history (
  iso TEXT NOT NULL,
  bucketAt TEXT NOT NULL,
  articleCount INTEGER DEFAULT 0,
  PRIMARY KEY (iso, bucketAt)
);
```

Add `upsertVelocityBucket` and `readVelocityHistory` functions.

- [ ] **Step 2: Run velocity tracking in ingest**

After article ingestion, count articles per region in the current 2h window. Store in velocity_history. Load 7-day history. Compute spikes. Include `velocitySpikes` in the briefing response.

- [ ] **Step 3: Run tests, commit**

```bash
git commit -m "feat: integrate velocity tracking into ingest pipeline"
```

---

### Task 5: Add coverage overlay to Globe and FlatMap

**Files:**
- Modify: `src/components/Globe.jsx`
- Modify: `src/components/FlatMap.jsx`
- Modify: `src/App.jsx`

- [ ] **Step 1: Add coverage overlay mode**

In App.jsx, the `mapOverlay` state already supports 'severity'. Add 'coverage' as a second option.

In Globe.jsx and FlatMap.jsx:
- When `mapOverlay === 'coverage'`, shade countries by silence/confidence status instead of severity
- Color scheme: green = covered, amber = sparse, red = silent/blind-spot, gray = limited-access
- Low-confidence regions appear slightly faded (opacity based on confidence score)
- Velocity spike regions get a pulsing amber ring

- [ ] **Step 2: Add velocity spike toast notifications**

In App.jsx, when `velocitySpikes` arrives from the briefing and contains items, show a toast: "Unusual activity spike in [region]: Nx normal volume"

- [ ] **Step 3: Add coverage toggle to Header legend**

In Header.jsx, add a button to toggle between severity and coverage overlay modes.

- [ ] **Step 4: Run tests, build check, commit**

```bash
git commit -m "feat: add coverage overlay with silence detection and velocity indicators"
```

---

### Task 6: Promote source health to Intel tab

**Files:**
- Modify: `src/components/FilterDrawer.jsx`

- [ ] **Step 1: Enhance Intel tab with source health**

In the INTEL tab of FilterDrawer, add:
- Feed status strip: "112/133 feeds healthy" with trend arrow
- Source drop alerts: highlight high-value sources that went dark
- Coverage gap suggestions: when regions are sparse/silent, show candidate source suggestions

These leverage existing `sourceHealth` and `coverageDiagnostics` data already passed to FilterDrawer.

- [ ] **Step 2: Add velocity badges to event cards in NewsPanel**

When an event is in a region with a velocity spike, show a small "SPIKE" badge on the event card.

- [ ] **Step 3: Add amplification filter to FilterDrawer**

In the FILTERS tab, add a toggle: "Hide amplified events" — filters out events where `amplification.isAmplified === true`.

- [ ] **Step 4: Run tests, commit**

```bash
git commit -m "feat: promote source health to Intel tab and add velocity/amplification UI"
```

---

### Task 7: Final integration test

- [ ] **Step 1: Run full test suite**

```bash
node --test
```

- [ ] **Step 2: Build check**

```bash
npx vite build
```

- [ ] **Step 3: Manual verification**

Start dev: `npm run dev`

Verify:
1. Coverage overlay: toggle from severity to coverage, countries shade by coverage health
2. Velocity spikes: if any regions have spikes, amber pulsing rings appear + toast
3. Region confidence: hover shows confidence tooltip
4. Intel tab: feed health strip with numbers
5. Amplification filter works
6. All existing functionality preserved

- [ ] **Step 4: Final commit**

```bash
git commit -m "feat: Phase 4 Coverage Intelligence complete"
```
