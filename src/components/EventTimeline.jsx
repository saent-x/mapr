import React, { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, ChevronRight, Play, Pause, FastForward } from 'lucide-react';
import {
  buildBuckets,
  fractionToTimestamp,
  getPredominantColor,
  BUCKET_COUNT,
  WINDOW_MS,
} from '../utils/timelineHelpers.js';

function formatHourMin(ts) {
  const d = new Date(ts);
  return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}Z`;
}

/**
 * Timeline strip — bottom band over the map surface. Renders a severity-binned
 * histogram of events in the current window, a draggable cursor bound to
 * `scrubTime`, and play/pause scrubbing.
 */
const EventTimeline = ({
  events = [],
  scrubTime,
  onScrub,
  onEventSelect,
  selectedStoryId,
}) => {
  const { t } = useTranslation();
  const trackRef = useRef(null);
  const [playing, setPlaying] = useState(false);

  const buckets = useMemo(() => buildBuckets(events, []), [events]);
  const maxBin = useMemo(() => Math.max(1, ...buckets.map((b) => b.count)), [buckets]);

  const now = Date.now();
  // Compute a cursor fraction in [0,1]. null scrubTime = live (1.0).
  const cursorFrac = scrubTime == null
    ? 1
    : Math.max(0, Math.min(1, 1 - (now - scrubTime) / WINDOW_MS));

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      const next = Math.min(1, (scrubTime == null ? 0 : cursorFrac) + 1 / BUCKET_COUNT);
      if (next >= 1) {
        onScrub?.(null);
        setPlaying(false);
      } else {
        onScrub?.(fractionToTimestamp(next));
      }
    }, 600);
    return () => clearInterval(id);
  }, [playing, cursorFrac, scrubTime, onScrub]);

  const scrubFromEvent = (e) => {
    const rect = trackRef.current?.getBoundingClientRect();
    if (!rect) return;
    const x = e.clientX - rect.left;
    const frac = Math.max(0, Math.min(1, x / rect.width));
    if (frac >= 0.995) onScrub?.(null);
    else onScrub?.(fractionToTimestamp(frac));
  };

  const cursorTs = scrubTime == null ? now : scrubTime;

  const W = 800;
  const H = 40;
  const BIN_W = W / BUCKET_COUNT - 1;

  return (
    <div className="timeline" role="group" aria-label="Event timeline">
      <div className="timeline-label">
        <div className="t1">TIMELINE · 7D</div>
        <div className="t2">{formatHourMin(cursorTs)}</div>
      </div>
      <div
        ref={trackRef}
        className="timeline-track"
        onClick={scrubFromEvent}
        role="slider"
        aria-valuemin={0}
        aria-valuemax={1}
        aria-valuenow={Number(cursorFrac.toFixed(2))}
        aria-label="Time cursor"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') onScrub?.(fractionToTimestamp(Math.max(0, cursorFrac - 1 / BUCKET_COUNT)));
          if (e.key === 'ArrowRight') {
            const next = Math.min(1, cursorFrac + 1 / BUCKET_COUNT);
            if (next >= 0.995) onScrub?.(null);
            else onScrub?.(fractionToTimestamp(next));
          }
        }}
      >
        <svg width="100%" height="50" viewBox={`0 0 ${W} 50`} preserveAspectRatio="none" aria-hidden>
          {[0, 12, 25, 37, 49].map((i) => (
            <line key={i} x1={(i / BUCKET_COUNT) * W} x2={(i / BUCKET_COUNT) * W} y1={8} y2={42} stroke="var(--line)" strokeWidth="0.5" />
          ))}
          {buckets.map((b, i) => {
            if (b.count === 0) return null;
            const x = (i / BUCKET_COUNT) * W;
            const hh = (b.count / maxBin) * 34;
            const y = 42 - hh;
            const color = getPredominantColor(b.lifecycleCounts || {});
            return (
              <rect
                key={i}
                x={x + 0.5}
                y={y}
                width={BIN_W}
                height={hh}
                fill={color}
                opacity={i / BUCKET_COUNT <= cursorFrac ? 1 : 0.35}
              />
            );
          })}
          <line
            x1={cursorFrac * W}
            x2={cursorFrac * W}
            y1={4}
            y2={46}
            stroke="var(--amber)"
            strokeWidth="1.2"
          />
          <polygon
            points={`${cursorFrac * W - 4},2 ${cursorFrac * W + 4},2 ${cursorFrac * W},8`}
            fill="var(--amber)"
          />
        </svg>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            fontFamily: 'var(--ff-mono)',
            fontSize: 9,
            color: 'var(--ink-3)',
            letterSpacing: '0.1em',
          }}
        >
          <span>−7D</span><span>−5D</span><span>−3D</span><span>−1D</span><span>NOW</span>
        </div>
      </div>
      <div className="timeline-ctrl">
        <button
          type="button"
          className="tl-btn"
          aria-label="Step back"
          onClick={() => onScrub?.(fractionToTimestamp(Math.max(0, cursorFrac - 1 / BUCKET_COUNT)))}
        >
          <ChevronLeft size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="tl-btn"
          data-active={playing}
          aria-pressed={playing}
          aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => setPlaying((v) => !v)}
        >
          {playing ? <Pause size={10} aria-hidden /> : <Play size={10} aria-hidden />}
        </button>
        <button
          type="button"
          className="tl-btn"
          aria-label="Step forward"
          onClick={() => {
            const next = Math.min(1, cursorFrac + 1 / BUCKET_COUNT);
            if (next >= 0.995) onScrub?.(null);
            else onScrub?.(fractionToTimestamp(next));
          }}
        >
          <ChevronRight size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="tl-btn"
          aria-label="Jump to live"
          onClick={() => { onScrub?.(null); setPlaying(false); }}
        >
          <FastForward size={10} aria-hidden />
        </button>
      </div>
    </div>
  );
};

export default EventTimeline;
