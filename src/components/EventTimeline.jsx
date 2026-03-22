import React, { useMemo, useRef, useCallback, useEffect } from 'react';

const BUCKET_COUNT = 50;
const WINDOW_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const LIFECYCLE_COLORS = {
  emerging: '#00d4ff',
  developing: '#00e5a0',
  escalating: '#ff5555',
  stabilizing: '#ffaa00',
  resolved: '#666666',
};

const LIFECYCLE_PRIORITY = ['escalating', 'developing', 'emerging', 'stabilizing', 'resolved'];

function getPredominantColor(lifecycleCounts) {
  for (const lc of LIFECYCLE_PRIORITY) {
    if (lifecycleCounts[lc] > 0) return LIFECYCLE_COLORS[lc];
  }
  return '#334155';
}

function buildBuckets(events, snapshotHistory) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  const bucketSize = WINDOW_MS / BUCKET_COUNT;

  // buckets[i] = { count: number, lifecycleCounts: { [lifecycle]: number } }
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
    // Use snapshot history to fill historical buckets
    for (const snapshot of snapshotHistory) {
      const savedAt = snapshot.savedAt ? new Date(snapshot.savedAt).getTime() : null;
      if (!savedAt) continue;
      const snapshotEvents = snapshot.events || [];
      for (const ev of snapshotEvents) {
        addToBucket(savedAt, ev.lifecycle);
      }
    }
  }

  // Always layer in current events by firstSeenAt (fills recent buckets and
  // any gap when snapshotHistory is empty)
  for (const ev of (events || [])) {
    const ts = ev.firstSeenAt ? new Date(ev.firstSeenAt).getTime() : null;
    addToBucket(ts, ev.lifecycle);
  }

  return buckets;
}

function timestampToX(ts, now, containerWidth) {
  const windowStart = now - WINDOW_MS;
  return Math.max(0, Math.min(containerWidth, ((ts - windowStart) / WINDOW_MS) * containerWidth));
}

function xToTimestamp(x, containerWidth) {
  const now = Date.now();
  const windowStart = now - WINDOW_MS;
  return windowStart + (x / containerWidth) * WINDOW_MS;
}

const EventTimeline = ({ events = [], snapshotHistory = [], onScrub, scrubTime }) => {
  const containerRef = useRef(null);
  const isDragging = useRef(false);

  const buckets = useMemo(
    () => buildBuckets(events, snapshotHistory),
    [events, snapshotHistory]
  );

  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.count)),
    [buckets]
  );

  const hasAnyData = buckets.some((b) => b.count > 0);

  const getPlayheadX = useCallback(() => {
    if (!containerRef.current) return null;
    const width = containerRef.current.offsetWidth;
    if (scrubTime == null) return width; // "now" = right edge
    const now = Date.now();
    return timestampToX(scrubTime, now, width);
  }, [scrubTime]);

  const handlePointerEvent = useCallback((e) => {
    if (!containerRef.current || !onScrub) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const ts = xToTimestamp(x, rect.width);
    onScrub(ts);
  }, [onScrub]);

  const handlePointerDown = useCallback((e) => {
    isDragging.current = true;
    containerRef.current?.setPointerCapture(e.pointerId);
    handlePointerEvent(e);
  }, [handlePointerEvent]);

  const handlePointerMove = useCallback((e) => {
    if (!isDragging.current) return;
    handlePointerEvent(e);
  }, [handlePointerEvent]);

  const handlePointerUp = useCallback((e) => {
    if (!isDragging.current) return;
    isDragging.current = false;
    containerRef.current?.releasePointerCapture(e.pointerId);
  }, []);

  // Compute playhead X for rendering
  const playheadX = getPlayheadX();

  return (
    <div className="event-timeline">
      <span className="event-timeline-label event-timeline-label--left">7d ago</span>

      <div
        ref={containerRef}
        className="event-timeline-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {hasAnyData ? (
          <div className="event-timeline-bars">
            {buckets.map((bucket, i) => {
              const heightPct = bucket.count > 0 ? Math.max(0.08, bucket.count / maxCount) : 0;
              const color = bucket.count > 0
                ? getPredominantColor(bucket.lifecycleCounts)
                : 'transparent';
              return (
                <div
                  key={i}
                  className="event-timeline-bar"
                  style={{
                    height: `${heightPct * 100}%`,
                    background: color,
                    opacity: bucket.count > 0 ? 0.85 : 0,
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="event-timeline-empty" />
        )}

        {/* Playhead */}
        {playheadX !== null && (
          <div
            className="event-timeline-playhead"
            style={{ left: `${playheadX}px` }}
          />
        )}
      </div>

      <span className="event-timeline-label event-timeline-label--right">now</span>
    </div>
  );
};

export default EventTimeline;
