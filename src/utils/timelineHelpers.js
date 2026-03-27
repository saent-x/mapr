/**
 * Pure-logic helpers for the EventTimeline component.
 * Shared between frontend (EventTimeline.jsx) and tests.
 */

export const BUCKET_COUNT = 50;
export const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export const LIFECYCLE_COLORS = {
  emerging: '#00d4ff',
  developing: '#00e5a0',
  escalating: '#ff5555',
  stabilizing: '#ffaa00',
  resolved: '#666666',
};

const LIFECYCLE_PRIORITY = ['escalating', 'developing', 'emerging', 'stabilizing', 'resolved'];

const DEFAULT_LIFECYCLE_COLOR = '#334155';

/**
 * Get the predominant lifecycle colour from a bucket's lifecycle counts.
 */
export function getPredominantColor(lifecycleCounts) {
  for (const lc of LIFECYCLE_PRIORITY) {
    if (lifecycleCounts[lc] > 0) return LIFECYCLE_COLORS[lc];
  }
  return DEFAULT_LIFECYCLE_COLOR;
}

/**
 * Build histogram buckets from events and optional snapshot history.
 */
export function buildBuckets(events, snapshotHistory) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const bucketSize = WINDOW_MS / BUCKET_COUNT;

  const buckets = Array.from({ length: BUCKET_COUNT }, () => ({
    count: 0,
    lifecycleCounts: {},
  }));

  function addToBucket(ts, lifecycle) {
    if (!ts || ts < windowStart || ts > now) return;
    const idx = Math.min(
      Math.floor((ts - windowStart) / bucketSize),
      BUCKET_COUNT - 1
    );
    buckets[idx].count += 1;
    const lc = lifecycle || 'unknown';
    buckets[idx].lifecycleCounts[lc] = (buckets[idx].lifecycleCounts[lc] || 0) + 1;
  }

  if (snapshotHistory && snapshotHistory.length > 0) {
    for (const snapshot of snapshotHistory) {
      const savedAt = snapshot.savedAt ? new Date(snapshot.savedAt).getTime() : null;
      if (!savedAt) continue;
      const snapshotEvents = snapshot.events || [];
      for (const ev of snapshotEvents) {
        addToBucket(savedAt, ev.lifecycle);
      }
    }
  }

  for (const ev of (events || [])) {
    const ts = ev.firstSeenAt ? new Date(ev.firstSeenAt).getTime() : null;
    addToBucket(ts, ev.lifecycle);
  }

  return buckets;
}

/**
 * Convert a timestamp to a 0–1 fraction within the time window.
 * 0 = windowStart (7 days ago), 1 = now.
 */
export function timestampToFraction(ts) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const frac = (ts - windowStart) / WINDOW_MS;
  return Math.max(0, Math.min(1, frac));
}

/**
 * Convert a fractional x position (0–1) back to a timestamp.
 */
export function fractionToTimestamp(frac) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  return windowStart + frac * WINDOW_MS;
}

/**
 * Return the lifecycle colour for a given lifecycle state.
 */
export function getLifecycleColor(lifecycle) {
  return LIFECYCLE_COLORS[lifecycle] || DEFAULT_LIFECYCLE_COLOR;
}

/**
 * Select the top N events by severity for display as individual timeline dots.
 * Only events within the 7-day window are included.
 */
export function pickTimelineEvents(events, limit = 20) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;

  return (events || [])
    .filter((ev) => {
      if (!ev.firstSeenAt) return false;
      const ts = new Date(ev.firstSeenAt).getTime();
      return ts >= windowStart && ts <= now;
    })
    .sort((a, b) => (b.severity || 0) - (a.severity || 0))
    .slice(0, limit);
}

/**
 * Format a timestamp into a short label for timeline ticks.
 * Shows "Mon", "Tue", etc. for day boundaries.
 */
export function formatTickLabel(ts) {
  const date = new Date(ts);
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${days[date.getDay()]} ${date.getDate()} ${months[date.getMonth()]}`;
}

/**
 * Generate day-boundary tick positions within the 7-day window.
 * Returns an array of { fraction, label } objects.
 */
export function generateDayTicks() {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const ticks = [];

  // Start at the next midnight after windowStart
  const startDate = new Date(windowStart);
  startDate.setHours(0, 0, 0, 0);
  let tickTime = startDate.getTime();
  if (tickTime < windowStart) tickTime += 24 * 60 * 60 * 1000;

  while (tickTime < now) {
    ticks.push({
      fraction: timestampToFraction(tickTime),
      label: formatTickLabel(tickTime),
      timestamp: tickTime,
    });
    tickTime += 24 * 60 * 60 * 1000;
  }

  return ticks;
}
