/**
 * Web Worker — runs the force-directed graph prewarm off the main thread.
 *
 * The main thread used to block for ~2-4 seconds on entity pages with
 * many nodes (PREWARM_TICKS=360 × O(n²) per tick). Moving the prewarm
 * here keeps the UI responsive: the worker computes final positions and
 * posts them back; the React component then runs the lightweight
 * per-frame ticks for animation.
 *
 * Protocol:
 *   in:  { type: 'prewarm', nodes, edges, worldW, worldH, ticks? }
 *   out: { type: 'prewarmDone', positions, finalAlpha }
 *   out: { type: 'prewarmError', message }
 */

import { prewarmAndExtract, PREWARM_TICKS } from '../utils/graphPhysics.js';

self.addEventListener('message', (event) => {
  const data = event.data || {};
  if (data.type !== 'prewarm') return;
  try {
    const result = prewarmAndExtract(
      data.nodes || [],
      data.edges || [],
      Number(data.worldW) || 0,
      Number(data.worldH) || 0,
      Number(data.ticks) || PREWARM_TICKS,
    );
    self.postMessage({ type: 'prewarmDone', ...result });
  } catch (err) {
    self.postMessage({ type: 'prewarmError', message: err?.message || String(err) });
  }
});
