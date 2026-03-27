import React, { useMemo, useRef, useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore';
import {
  buildBuckets,
  pickTimelineEvents,
  timestampToFraction,
  fractionToTimestamp,
  getLifecycleColor,
  getPredominantColor,
  generateDayTicks,
  LIFECYCLE_COLORS,
  BUCKET_COUNT,
} from '../utils/timelineHelpers.js';

const MAX_VISIBLE_EVENTS = 20;

/**
 * Try to find the matching activeNews story for a backend event.
 * Matches on title prefix overlap (first 40 chars) + same country.
 */
function findMatchingStory(backendEvent, activeNews) {
  if (!backendEvent || !activeNews) return null;
  const titlePrefix = (backendEvent.title || '').toLowerCase().slice(0, 40);
  const country = backendEvent.primaryCountry;

  // Exact title match first
  let match = activeNews.find(
    (s) => (s.title || '').toLowerCase().slice(0, 40) === titlePrefix
  );
  if (match) return match;

  // Country + partial title overlap
  if (country) {
    match = activeNews.find(
      (s) => s.isoA2 === country && (s.title || '').toLowerCase().includes(titlePrefix.slice(0, 20))
    );
  }
  return match || null;
}

const EventTimeline = ({
  events = [],
  snapshotHistory = [],
  onScrub,
  scrubTime,
  onEventSelect,
  selectedStoryId,
}) => {
  const { t } = useTranslation();
  const containerRef = useRef(null);
  const isDragging = useRef(false);
  const [hoveredEvent, setHoveredEvent] = useState(null);
  const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });

  // Get backend events (with lifecycle data) from the store
  const backendEvents = useNewsStore((s) => s.backendEvents);

  // Build histogram buckets
  const buckets = useMemo(
    () => buildBuckets(events, snapshotHistory),
    [events, snapshotHistory]
  );

  const maxCount = useMemo(
    () => Math.max(1, ...buckets.map((b) => b.count)),
    [buckets]
  );

  const hasAnyData = buckets.some((b) => b.count > 0);

  // Pick top events for individual markers (using backendEvents for lifecycle)
  const timelineEvents = useMemo(() => {
    const picked = pickTimelineEvents(backendEvents, MAX_VISIBLE_EVENTS);
    return picked.map((ev) => ({
      ...ev,
      fraction: timestampToFraction(new Date(ev.firstSeenAt).getTime()),
    }));
  }, [backendEvents]);

  // Generate day ticks
  const dayTicks = useMemo(() => generateDayTicks(), []);

  // Scrub handlers
  const handlePointerEvent = useCallback((e) => {
    if (!containerRef.current || !onScrub) return;
    const rect = containerRef.current.getBoundingClientRect();
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const fraction = x / rect.width;
    const ts = fractionToTimestamp(fraction);
    onScrub(ts);
  }, [onScrub]);

  const handlePointerDown = useCallback((e) => {
    // Don't start scrubbing if clicking on an event dot
    if (e.target.closest('.event-timeline-dot')) return;
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

  // Event click handler
  const handleEventClick = useCallback((ev, e) => {
    e.stopPropagation();
    if (!onEventSelect) return;

    // Try to find matching story in activeNews for proper selection
    const matchingStory = findMatchingStory(ev, events);
    if (matchingStory) {
      onEventSelect(matchingStory);
    } else {
      // Fallback: construct minimal story-like object for selection
      onEventSelect({
        id: ev.id,
        isoA2: ev.primaryCountry,
        title: ev.title,
        severity: ev.severity,
        coordinates: ev.coordinates,
      });
    }
  }, [onEventSelect, events]);

  // Tooltip handlers
  const handleEventMouseEnter = useCallback((ev, e) => {
    const rect = e.target.getBoundingClientRect();
    setHoveredEvent(ev);
    setTooltipPos({ x: rect.left + rect.width / 2, y: rect.top });
  }, []);

  const handleEventMouseLeave = useCallback(() => {
    setHoveredEvent(null);
  }, []);

  // Compute playhead position
  const playheadFraction = useMemo(() => {
    if (scrubTime == null) return 1; // "now" = right edge
    return timestampToFraction(scrubTime);
  }, [scrubTime]);

  // Lifecycle legend data
  const activeCycles = useMemo(() => {
    const seen = new Set(backendEvents.map((e) => e.lifecycle).filter(Boolean));
    return ['emerging', 'developing', 'escalating', 'stabilizing', 'resolved'].filter(
      (lc) => seen.has(lc)
    );
  }, [backendEvents]);

  return (
    <div className="event-timeline" role="region" aria-label={t('timeline.label', 'Event timeline')}>
      <span className="event-timeline-label event-timeline-label--left">
        {t('timeline.past', '7d ago')}
      </span>

      <div
        ref={containerRef}
        className="event-timeline-track"
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      >
        {/* Histogram bars */}
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
                    opacity: bucket.count > 0 ? 0.45 : 0,
                  }}
                />
              );
            })}
          </div>
        ) : (
          <div className="event-timeline-empty" />
        )}

        {/* Day tick marks */}
        {dayTicks.map((tick, i) => (
          <div
            key={`tick-${i}`}
            className="event-timeline-tick"
            style={{ left: `${tick.fraction * 100}%` }}
          >
            <span className="event-timeline-tick-label">{tick.label}</span>
          </div>
        ))}

        {/* Individual event dots */}
        <div className="event-timeline-events">
          {timelineEvents.map((ev) => {
            const isSelected = selectedStoryId && findMatchingStory(ev, events)?.id === selectedStoryId;
            return (
              <button
                key={ev.id}
                type="button"
                className={`event-timeline-dot${isSelected ? ' is-selected' : ''}`}
                style={{
                  left: `${ev.fraction * 100}%`,
                  '--dot-color': getLifecycleColor(ev.lifecycle),
                }}
                onClick={(e) => handleEventClick(ev, e)}
                onMouseEnter={(e) => handleEventMouseEnter(ev, e)}
                onMouseLeave={handleEventMouseLeave}
                aria-label={`${ev.title} - ${ev.lifecycle}`}
              />
            );
          })}
        </div>

        {/* Playhead */}
        <div
          className="event-timeline-playhead"
          style={{ left: `${playheadFraction * 100}%` }}
        />
      </div>

      <span className="event-timeline-label event-timeline-label--right">
        {t('timeline.now', 'now')}
      </span>

      {/* Lifecycle legend */}
      {activeCycles.length > 0 && (
        <div className="event-timeline-legend">
          {activeCycles.map((lc) => (
            <span key={lc} className="event-timeline-legend-item">
              <span
                className="event-timeline-legend-dot"
                style={{ background: LIFECYCLE_COLORS[lc] }}
              />
              {t(`timeline.lifecycle.${lc}`, lc)}
            </span>
          ))}
        </div>
      )}

      {/* Tooltip */}
      {hoveredEvent && (
        <div
          className="event-timeline-tooltip"
          style={{
            left: `${tooltipPos.x}px`,
            top: `${tooltipPos.y}px`,
          }}
        >
          <span
            className="event-timeline-tooltip-lifecycle"
            style={{ color: getLifecycleColor(hoveredEvent.lifecycle) }}
          >
            {hoveredEvent.lifecycle}
          </span>
          <span className="event-timeline-tooltip-title">
            {(hoveredEvent.title || '').slice(0, 60)}
            {(hoveredEvent.title || '').length > 60 ? '…' : ''}
          </span>
          <span className="event-timeline-tooltip-time">
            {new Date(hoveredEvent.firstSeenAt).toLocaleString(undefined, {
              month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
            })}
          </span>
        </div>
      )}
    </div>
  );
};

export default EventTimeline;
