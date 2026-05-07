import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Play, Pause, SkipBack, SkipForward, Clock } from 'lucide-react';

function formatTimestamp(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * TimeTravelScrubber — range slider for scrubbing through historical snapshots.
 * Emits onScrub callback with the selected timestamp as the user drags.
 */
export default function TimeTravelScrubber({
  timestamps = [],
  onScrub,
  onClose,
  onPlayStateChange,
}) {
  const { t } = useTranslation();
  const [index, setIndex] = useState(timestamps.length - 1);
  const [playing, setPlaying] = useState(false);
  const intervalRef = useRef(null);

  const count = timestamps.length;
  const currentTs = timestamps[index];

  // When timestamps change externally, reset to last
  useEffect(() => {
    if (timestamps.length > 0) {
      setIndex(timestamps.length - 1);
    }
  }, [timestamps]);

  // Notify parent when current timestamp changes
  const emitScrub = useCallback((idx) => {
    const ts = timestamps[idx];
    if (ts) onScrub?.(ts);
  }, [timestamps, onScrub]);

  // Play/pause auto-scrub
  useEffect(() => {
    if (playing) {
      onPlayStateChange?.(true);
      intervalRef.current = setInterval(() => {
        setIndex((prev) => {
          const next = prev + 1;
          if (next >= timestamps.length) {
            setPlaying(false);
            return prev;
          }
          emitScrub(next);
          return next;
        });
      }, 800);
    } else {
      onPlayStateChange?.(false);
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    }
    return () => {
      if (intervalRef.current) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [playing, timestamps.length, emitScrub, onPlayStateChange]);

  const handleChange = useCallback((e) => {
    const val = Number(e.target.value);
    setIndex(val);
    emitScrub(val);
  }, [emitScrub]);

  const handleStepBack = useCallback(() => {
    setIndex((prev) => {
      const next = Math.max(0, prev - 1);
      emitScrub(next);
      return next;
    });
  }, [emitScrub]);

  const handleStepForward = useCallback(() => {
    setIndex((prev) => {
      const next = Math.min(timestamps.length - 1, prev + 1);
      emitScrub(next);
      return next;
    });
  }, [timestamps.length, emitScrub]);

  const handleJumpStart = useCallback(() => {
    setIndex(0);
    emitScrub(0);
  }, [emitScrub]);

  const handleJumpEnd = useCallback(() => {
    const last = timestamps.length - 1;
    setIndex(last);
    emitScrub(last);
  }, [timestamps.length, emitScrub]);

  if (count === 0) {
    return (
      <div className="mapr-scrubber">
        <p className="mapr-scrubber-empty">{t('historicalQueries.noSnapshots')}</p>
        <style>{scrubberCSS}</style>
      </div>
    );
  }

  return (
    <div className="mapr-scrubber">
      <div className="mapr-scrubber-header">
        <Clock size={14} />
        <span className="mapr-scrubber-title">{t('historicalQueries.timeTravel')}</span>
        <div className="mapr-scrubber-current">
          {currentTs ? formatTimestamp(currentTs) : '—'}
        </div>
      </div>

      <div className="mapr-scrubber-controls">
        <button
          className="mapr-scrubber-btn"
          onClick={handleJumpStart}
          disabled={index === 0}
          title={t('historicalQueries.jumpStart')}
          type="button"
        >
          <SkipBack size={14} />
        </button>
        <button
          className="mapr-scrubber-btn"
          onClick={handleStepBack}
          disabled={index === 0}
          title={t('historicalQueries.stepBack')}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="19 20 9 12 19 4 19 20" />
            <line x1="5" y1="19" x2="5" y2="5" />
          </svg>
        </button>
        <button
          className="mapr-scrubber-btn mapr-scrubber-play"
          onClick={() => setPlaying(!playing)}
          title={playing ? t('historicalQueries.pause') : t('historicalQueries.play')}
          type="button"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
        </button>
        <button
          className="mapr-scrubber-btn"
          onClick={handleStepForward}
          disabled={index >= count - 1}
          title={t('historicalQueries.stepForward')}
          type="button"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 4 15 12 5 20 5 4" />
            <line x1="19" y1="5" x2="19" y2="19" />
          </svg>
        </button>
        <button
          className="mapr-scrubber-btn"
          onClick={handleJumpEnd}
          disabled={index >= count - 1}
          title={t('historicalQueries.jumpEnd')}
          type="button"
        >
          <SkipForward size={14} />
        </button>
      </div>

      <div className="mapr-scrubber-slider-container">
        <input
          type="range"
          className="mapr-scrubber-slider"
          min={0}
          max={count - 1}
          value={index}
          onChange={handleChange}
        />
        <div className="mapr-scrubber-labels">
          <span>{timestamps.length > 0 ? formatTimestamp(timestamps[0]) : ''}</span>
          <span>{timestamps.length > 0 ? formatTimestamp(timestamps[timestamps.length - 1]) : ''}</span>
        </div>
      </div>

      <div className="mapr-scrubber-info">
        {t('historicalQueries.snapshotNOfM', { current: index + 1, total: count })}
      </div>

      <style>{scrubberCSS}</style>
    </div>
  );
}

const scrubberCSS = `
  .mapr-scrubber {
    padding: 12px;
    background: var(--bg-1);
    border: 1px solid var(--border);
    border-radius: 8px;
  }
  .mapr-scrubber-header {
    display: flex;
    align-items: center;
    gap: 8px;
    margin-bottom: 10px;
  }
  .mapr-scrubber-title {
    font-size: 0.75rem;
    font-weight: 600;
    color: var(--text-0);
    text-transform: uppercase;
    letter-spacing: 0.05em;
    flex: 1;
  }
  .mapr-scrubber-current {
    font-size: 0.6875rem;
    color: var(--amber);
    font-family: var(--ff-mono);
    background: color-mix(in srgb, var(--amber) 15%, transparent);
    padding: 2px 8px;
    border-radius: 3px;
  }
  .mapr-scrubber-controls {
    display: flex;
    align-items: center;
    gap: 4px;
    justify-content: center;
    margin-bottom: 10px;
  }
  .mapr-scrubber-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid var(--border);
    border-radius: 4px;
    background: var(--bg-2);
    color: var(--text-1);
    cursor: pointer;
    transition: all 0.15s;
  }
  .mapr-scrubber-btn:hover:not(:disabled) {
    border-color: var(--amber);
    color: var(--amber);
  }
  .mapr-scrubber-btn:disabled {
    opacity: 0.3;
    cursor: not-allowed;
  }
  .mapr-scrubber-play {
    background: var(--amber);
    color: var(--bg-0);
    border-color: var(--amber);
  }
  .mapr-scrubber-play:hover {
    opacity: 0.85;
  }
  .mapr-scrubber-slider-container {
    margin-bottom: 8px;
  }
  .mapr-scrubber-slider {
    width: 100%;
    height: 4px;
    -webkit-appearance: none;
    appearance: none;
    background: var(--border);
    border-radius: 2px;
    outline: none;
    cursor: pointer;
  }
  .mapr-scrubber-slider::-webkit-slider-thumb {
    -webkit-appearance: none;
    width: 16px;
    height: 16px;
    border-radius: 50%;
    background: var(--amber);
    cursor: pointer;
    border: 2px solid var(--bg-0);
  }
  .mapr-scrubber-labels {
    display: flex;
    justify-content: space-between;
    font-size: 0.625rem;
    color: var(--text-2);
    font-family: var(--ff-mono);
    margin-top: 4px;
  }
  .mapr-scrubber-info {
    font-size: 0.6875rem;
    color: var(--text-2);
    text-align: center;
  }
  .mapr-scrubber-empty {
    font-size: 0.75rem;
    color: var(--text-2);
    text-align: center;
    padding: 12px;
  }
`;
