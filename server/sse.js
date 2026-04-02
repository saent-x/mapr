/**
 * Server-Sent Events (SSE) broadcast module.
 *
 * Manages connected SSE clients and provides a broadcast function
 * used by the ingestion pipeline to push real-time updates.
 */

/** @type {Set<import('node:http').ServerResponse>} */
const clients = new Set();
let heartbeatTimer = null;

/**
 * Add a connected SSE response to the client set.
 * @param {import('node:http').ServerResponse} res
 */
export function addClient(res) {
  clients.add(res);
  ensureHeartbeat();
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

/**
 * Send an SSE event to all connected clients.
 * @param {string} event - Event name (e.g. 'data-update')
 * @param {object} data - JSON-serializable payload
 */
export function broadcast(event, data) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const res of clients) {
    try {
      res.write(payload);
    } catch {
      clients.delete(res);
    }
  }
}

/** Return the number of currently connected SSE clients. */
export function clientCount() {
  return clients.size;
}

function ensureHeartbeat() {
  if (heartbeatTimer) return;
  heartbeatTimer = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': heartbeat\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, 30_000);
}
