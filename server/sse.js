/**
 * Server-Sent Events (SSE) broadcast module.
 *
 * Manages connected SSE clients and provides a broadcast function
 * used by the ingestion pipeline to push real-time updates.
 *
 * Capacity & backpressure:
 *   - `MAX_CLIENTS` caps the in-memory client set so a hostile or buggy
 *     caller can't open unlimited streams. New clients beyond the cap
 *     get rejected by `addClient`.
 *   - On each broadcast we honour Node's stream backpressure: if
 *     `res.write` returns `false`, the client's socket is full; we
 *     drop and close that client rather than queueing in process memory.
 */

const MAX_CLIENTS = Number(process.env.SSE_MAX_CLIENTS || 500);

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
let heartbeatTimer = null;

/**
 * Add a connected SSE response to the client set. Returns `true` if
 * accepted, `false` if the cap is reached and the caller should 503.
 * @param {import('node:http').ServerResponse} res
 */
export function addClient(res) {
  if (clients.size >= MAX_CLIENTS) return false;
  clients.add(res);
  ensureHeartbeat();
  return true;
}

/**
 * Remove a disconnected SSE response from the client set.
 * @param {import('node:http').ServerResponse} res
 */
export function removeClient(res) {
  clients.delete(res);
  if (clients.size === 0 && heartbeatTimer) {
    clearInterval(heartbeatTimer);
    heartbeatTimer = null;
  }
}

function dropClient(res) {
  clients.delete(res);
  try { res.end(); } catch { /* already closed */ }
}

/**
 * Send an SSE event to all connected clients. Slow consumers are
 * dropped — better to lose a stale client than to OOM the process.
 * @param {string} event - Event name (e.g. 'data-update')
 * @param {object} data - JSON-serializable payload
 */
export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      const ok = res.write(payload);
      if (!ok) {
        // Socket buffer full → backpressure. Don't queue in memory.
        dropClient(res);
      }
    } catch {
      dropClient(res);
    }
  }
}

/** Return the number of currently connected SSE clients. */
export function clientCount() {
  return clients.size;
}

/** Capacity for diagnostics / admin-health. */
export function clientCapacity() {
  return MAX_CLIENTS;
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      try {
        const ok = res.write(': heartbeat\n\n');
        if (!ok) dropClient(res);
      } catch {
        dropClient(res);
      }
    }
  }, 30_000);
}
