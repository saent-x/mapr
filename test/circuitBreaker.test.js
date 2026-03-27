import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  isCircuitOpen,
  recordSuccess,
  recordFailure,
  getCircuitStates,
  getCircuitSummary,
  resetAllCircuits,
  resetCircuit,
  FAILURE_THRESHOLD,
  COOLDOWN_MS,
  STATE_CLOSED,
  STATE_OPEN,
  STATE_HALF_OPEN
} from '../server/circuitBreaker.js';

describe('circuitBreaker', () => {
  beforeEach(() => {
    resetAllCircuits();
  });

  it('starts in closed state for unknown sources', () => {
    assert.equal(isCircuitOpen('feed-1'), false);
  });

  it('stays closed after fewer than FAILURE_THRESHOLD failures', () => {
    for (let i = 0; i < FAILURE_THRESHOLD - 1; i++) {
      recordFailure('feed-1');
    }
    assert.equal(isCircuitOpen('feed-1'), false);
  });

  it('opens circuit after FAILURE_THRESHOLD consecutive failures', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure('feed-1');
    }
    assert.equal(isCircuitOpen('feed-1'), true);
  });

  it('resets failure count on success', () => {
    recordFailure('feed-1');
    recordFailure('feed-1');
    recordSuccess('feed-1');
    recordFailure('feed-1');
    // Only 1 failure since last success, should be closed
    assert.equal(isCircuitOpen('feed-1'), false);
  });

  it('tracks circuits independently per source', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure('feed-1');
    }
    recordFailure('feed-2');

    assert.equal(isCircuitOpen('feed-1'), true);
    assert.equal(isCircuitOpen('feed-2'), false);
  });

  it('getCircuitStates returns all tracked circuits', () => {
    recordFailure('feed-1');
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure('feed-2');
    }

    const states = getCircuitStates();
    assert.equal(states['feed-1'].state, STATE_CLOSED);
    assert.equal(states['feed-1'].failures, 1);
    assert.equal(states['feed-2'].state, STATE_OPEN);
    assert.equal(states['feed-2'].failures, FAILURE_THRESHOLD);
    assert.ok(states['feed-2'].openedAt);
  });

  it('getCircuitSummary counts open, half-open, and closed circuits', () => {
    recordSuccess('feed-1'); // closed
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure('feed-2'); // open
    }

    const summary = getCircuitSummary();
    assert.equal(summary.total, 2);
    assert.equal(summary.open, 1);
    assert.equal(summary.closed, 1);
    assert.equal(summary.halfOpen, 0);
  });

  it('resetCircuit removes a single circuit', () => {
    recordFailure('feed-1');
    resetCircuit('feed-1');
    const states = getCircuitStates();
    assert.equal(states['feed-1'], undefined);
  });

  it('resetAllCircuits clears all circuits', () => {
    recordFailure('feed-1');
    recordFailure('feed-2');
    resetAllCircuits();
    const summary = getCircuitSummary();
    assert.equal(summary.total, 0);
  });

  it('success after open circuit resets to closed', () => {
    for (let i = 0; i < FAILURE_THRESHOLD; i++) {
      recordFailure('feed-1');
    }
    assert.equal(isCircuitOpen('feed-1'), true);

    // Simulate a success (e.g., after half-open probe)
    recordSuccess('feed-1');
    assert.equal(isCircuitOpen('feed-1'), false);

    const states = getCircuitStates();
    assert.equal(states['feed-1'].state, STATE_CLOSED);
    assert.equal(states['feed-1'].failures, 0);
  });

  it('FAILURE_THRESHOLD is 3', () => {
    assert.equal(FAILURE_THRESHOLD, 3);
  });

  it('COOLDOWN_MS is 10 minutes', () => {
    assert.equal(COOLDOWN_MS, 10 * 60 * 1000);
  });
});
