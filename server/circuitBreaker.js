/**
 * Circuit Breaker for External Source Fetching
 *
 * Tracks consecutive failures per source and temporarily skips sources
 * that fail too many times in a row. After a cooldown period, the source
 * is retried (half-open state). A successful fetch resets the failure count.
 *
 * States:
 *   - CLOSED:    Normal operation, requests pass through
 *   - OPEN:      Source is failing, requests are blocked
 *   - HALF_OPEN: Cooldown expired, next request is a test probe
 */

const FAILURE_THRESHOLD = 3;
const COOLDOWN_MS = 10 * 60 * 1000; // 10 minutes

const STATE_CLOSED = 'closed';
const STATE_OPEN = 'open';
const STATE_HALF_OPEN = 'half-open';

/** @type {Map<string, { failures: number, state: string, lastFailureAt: number|null, openedAt: number|null }>} */
const circuits = new Map();

function getOrCreateCircuit(sourceId) {
  if (!circuits.has(sourceId)) {
    circuits.set(sourceId, {
      failures: 0,
      state: STATE_CLOSED,
      lastFailureAt: null,
      openedAt: null
    });
  }
  return circuits.get(sourceId);
}

/**
 * Check whether the circuit for a source is open (should be skipped).
 * If the cooldown has expired, transitions to half-open to allow a probe.
 *
 * @param {string} sourceId - Unique source identifier (e.g., feed ID)
 * @returns {boolean} true if the source should be skipped
 */
export function isCircuitOpen(sourceId) {
  const circuit = circuits.get(sourceId);
  if (!circuit || circuit.state === STATE_CLOSED) {
    return false;
  }

  if (circuit.state === STATE_OPEN) {
    const elapsed = Date.now() - (circuit.openedAt || 0);
    if (elapsed >= COOLDOWN_MS) {
      circuit.state = STATE_HALF_OPEN;
      return false; // allow a probe request
    }
    return true; // still in cooldown
  }

  // HALF_OPEN: allow the probe
  return false;
}

/**
 * Record a successful fetch for a source. Resets the circuit to closed.
 *
 * @param {string} sourceId - Unique source identifier
 */
export function recordSuccess(sourceId) {
  const circuit = getOrCreateCircuit(sourceId);
  circuit.failures = 0;
  circuit.state = STATE_CLOSED;
  circuit.lastFailureAt = null;
  circuit.openedAt = null;
}

/**
 * Record a failed fetch for a source. If failures reach the threshold,
 * the circuit opens and the source will be skipped until cooldown expires.
 *
 * @param {string} sourceId - Unique source identifier
 */
export function recordFailure(sourceId) {
  const circuit = getOrCreateCircuit(sourceId);
  circuit.failures += 1;
  circuit.lastFailureAt = Date.now();

  if (circuit.failures >= FAILURE_THRESHOLD) {
    circuit.state = STATE_OPEN;
    circuit.openedAt = Date.now();
  }
}

/**
 * Get the current state of all circuits (for health/diagnostics).
 *
 * @returns {Object} Map of sourceId → circuit state
 */
export function getCircuitStates() {
  const states = {};
  for (const [sourceId, circuit] of circuits) {
    states[sourceId] = {
      state: circuit.state,
      failures: circuit.failures,
      lastFailureAt: circuit.lastFailureAt ? new Date(circuit.lastFailureAt).toISOString() : null,
      openedAt: circuit.openedAt ? new Date(circuit.openedAt).toISOString() : null
    };
  }
  return states;
}

/**
 * Get a summary of circuit breaker status.
 *
 * @returns {{ total: number, open: number, halfOpen: number, closed: number }}
 */
export function getCircuitSummary() {
  let open = 0;
  let halfOpen = 0;
  let closed = 0;

  for (const circuit of circuits.values()) {
    // Re-evaluate state for stale open circuits
    if (circuit.state === STATE_OPEN) {
      const elapsed = Date.now() - (circuit.openedAt || 0);
      if (elapsed >= COOLDOWN_MS) {
        open--; // will be counted as half-open
        halfOpen++;
        continue;
      }
    }
    if (circuit.state === STATE_OPEN) open++;
    else if (circuit.state === STATE_HALF_OPEN) halfOpen++;
    else closed++;
  }

  return { total: circuits.size, open, halfOpen, closed };
}

/**
 * Reset all circuits (for testing).
 */
export function resetAllCircuits() {
  circuits.clear();
}

/**
 * Reset a single circuit (for manual override / admin).
 *
 * @param {string} sourceId
 */
export function resetCircuit(sourceId) {
  circuits.delete(sourceId);
}

// Export constants for testing
export { FAILURE_THRESHOLD, COOLDOWN_MS, STATE_CLOSED, STATE_OPEN, STATE_HALF_OPEN };
