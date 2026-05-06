import React, { useMemo, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore.js';
import {
  buildCorrelationData,
  severityColor,
  formatCorrelationTimestamp,
} from '../utils/correlationBuilder.js';

const DOT_RADIUS = 6;
const LANE_HEIGHT = 60;
const LANE_GAP = 4;
const LABEL_WIDTH = 90;
const TIME_AXIS_HEIGHT = 28;
const PAD_LEFT = 20;
const PAD_RIGHT = 20;
const PAD_TOP = 8;
const CHART_MIN_WIDTH = 600;

/**
 * Time range options in hours, with corresponding i18n label keys.
 */
const TIME_RANGE_OPTIONS = [
  { hours: 72, label: 'correlation.range3d' },
  { hours: 168, label: 'correlation.range7d' },
  { hours: 720, label: 'correlation.range30d' },
];

/**
 * Severity threshold options with i18n label keys.
 */
const SEVERITY_OPTIONS = [
  { min: 0, label: 'correlation.sevAll' },
  { min: 20, label: 'correlation.sevWatch' },
  { min: 40, label: 'correlation.sevElevated' },
  { min: 70, label: 'correlation.sevCritical' },
];

/**
 * EventCorrelationTimeline — SVG-based horizontal lane chart showing
 * correlated events across regions.
 *
 * Lanes = regions, dots = events, cross-lane lines = shared entities.
 */
export default function EventCorrelationTimeline({ prefilterEntity = '' } = {}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const liveNews = useNewsStore((s) => s.liveNews);
  const backendEvents = useNewsStore((s) => s.backendEvents);

  const [hours, setHours] = useState(168); // 7d default
  const [minSev, setMinSev] = useState(0);
  const [entityQ, setEntityQ] = useState(prefilterEntity || '');
  const [selectedEvent, setSelectedEvent] = useState(null);

  const events = useMemo(() => {
    if (backendEvents && backendEvents.length > 0) return backendEvents;
    return liveNews || [];
  }, [backendEvents, liveNews]);

  const { lanes, correlations, timeRange } = useMemo(
    () => buildCorrelationData(events, {
      maxAgeHours: hours,
      minSeverity: minSev,
      entityFilter: entityQ,
    }),
    [events, hours, minSev, entityQ],
  );

  const tSpan = timeRange.max - timeRange.min || 1;

  // Build a map for quick event lookup
  const eventMap = useMemo(() => {
    const m = new Map();
    for (const ev of events) m.set(ev.id, ev);
    return m;
  }, [events]);

  // Map of correlation lines: key = "fromId|toId"
  const corrSet = useMemo(() => {
    const s = new Set();
    for (const c of correlations) {
      s.add(`${c.from}|${c.to}`);
      s.add(`${c.to}|${c.from}`);
    }
    return s;
  }, [correlations]);

  const chartW = Math.max(CHART_MIN_WIDTH, lanes.length > 0 ? 800 : CHART_MIN_WIDTH);
  const plotW = chartW - PAD_LEFT - PAD_RIGHT - LABEL_WIDTH;
  const chartH = lanes.length * (LANE_HEIGHT + LANE_GAP) + TIME_AXIS_HEIGHT + PAD_TOP + 8;

  const xAt = useCallback((ts) => {
    const pct = tSpan > 0 ? (ts - timeRange.min) / tSpan : 0.5;
    return LABEL_WIDTH + PAD_LEFT + pct * plotW;
  }, [timeRange.min, tSpan, plotW]);

  const yAt = useCallback((laneIdx) => {
    return PAD_TOP + laneIdx * (LANE_HEIGHT + LANE_GAP) + LANE_HEIGHT / 2 + 4;
  }, []);

  const handleDotClick = useCallback((ev) => {
    setSelectedEvent(ev);
  }, []);

  const handleNavigateToEvent = useCallback(() => {
    if (!selectedEvent) return;
    if (selectedEvent.id) {
      navigate(`/?event=${selectedEvent.id}`);
    }
  }, [selectedEvent, navigate]);

  const timeLabels = useMemo(() => {
    const labels = [];
    const count = 5;
    for (let i = 0; i <= count; i++) {
      const ts = timeRange.min + (i / count) * tSpan;
      labels.push({ ts, label: formatCorrelationTimestamp(ts) });
    }
    return labels;
  }, [timeRange.min, tSpan]);

  return (
    <div className="correlation-timeline" data-testid="correlation-timeline">
      {/* Filters bar */}
      <div className="correlation-filters" role="toolbar" aria-label={t('correlation.filterAriaLabel')}>
        {/* Entity filter */}
        <div className="correlation-filter-group">
          <label className="correlation-filter-label" htmlFor="corr-entity-filter">
            {t('correlation.entityFilter')}
          </label>
          <input
            id="corr-entity-filter"
            type="text"
            className="correlation-entity-input"
            placeholder={t('correlation.entityFilterPlaceholder')}
            value={entityQ}
            onChange={(e) => setEntityQ(e.target.value)}
            data-testid="correlation-entity-filter"
          />
        </div>

        {/* Time range */}
        <div className="correlation-filter-group">
          <label className="correlation-filter-label">{t('correlation.timeRangeFilter')}</label>
          <div className="correlation-chip-group" role="group" aria-label={t('correlation.timeRangeFilter')}>
            {TIME_RANGE_OPTIONS.map((tr) => (
              <button
                key={tr.hours}
                className="toggle-chip"
                data-active={hours === tr.hours ? 'true' : 'false'}
                onClick={() => setHours(tr.hours)}
                aria-pressed={hours === tr.hours}
              >
                {t(tr.label)}
              </button>
            ))}
          </div>
        </div>

        {/* Severity filter */}
        <div className="correlation-filter-group">
          <label className="correlation-filter-label">{t('correlation.severityFilter')}</label>
          <div className="correlation-chip-group" role="group" aria-label={t('correlation.severityFilter')}>
            {SEVERITY_OPTIONS.map((st) => (
              <button
                key={st.min}
                className="toggle-chip"
                data-active={minSev === st.min ? 'true' : 'false'}
                onClick={() => setMinSev(st.min)}
                aria-pressed={minSev === st.min}
              >
                {t(st.label)}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="correlation-stats" data-testid="correlation-stats">
        <span className="mono">
          {t('correlation.eventCount', { count: lanes.reduce((s, l) => s + l.events.length, 0) })}
        </span>
        <span className="mono">
          {t('correlation.regionCount', { count: lanes.length })}
        </span>
        <span className="mono">
          {t('correlation.correlationCount', { count: correlations.length })}
        </span>
      </div>

      {/* Lane chart */}
      <div className="correlation-chart-wrap" data-testid="correlation-chart">
        <svg
          width={chartW}
          height={chartH}
          viewBox={`0 0 ${chartW} ${chartH}`}
          role="img"
          aria-label={t('correlation.chartAriaLabel')}
          style={{ display: 'block', width: '100%', minHeight: chartH }}
        >
          {/* Background for lanes */}
          {lanes.map((lane, li) => (
            <rect
              key={`bg-${lane.region}`}
              x={LABEL_WIDTH + PAD_LEFT}
              y={PAD_TOP + li * (LANE_HEIGHT + LANE_GAP) + 4}
              width={plotW}
              height={LANE_HEIGHT}
              fill="var(--bg-2)"
              opacity="0.5"
              rx="3"
            />
          ))}

          {/* Time axis grid lines */}
          {timeLabels.map((tl, i) => (
            <g key={`tick-${i}`}>
              <line
                x1={xAt(tl.ts)}
                y1={PAD_TOP + 4}
                x2={xAt(tl.ts)}
                y2={lanes.length * (LANE_HEIGHT + LANE_GAP) + PAD_TOP + 4}
                stroke="var(--line)"
                strokeWidth="0.5"
                strokeDasharray="3 3"
                opacity="0.4"
              />
              <text
                x={xAt(tl.ts)}
                y={lanes.length * (LANE_HEIGHT + LANE_GAP) + PAD_TOP + 18}
                textAnchor="middle"
                fontSize="9"
                fontFamily="var(--ff-mono)"
                fill="var(--ink-2)"
              >
                {tl.label}
              </text>
            </g>
          ))}

          {/* Correlation lines (behind dots) */}
          {correlations.map((c, ci) => {
            const fromLane = lanes.findIndex((l) => l.region === c.fromRegion);
            const toLane = lanes.findIndex((l) => l.region === c.toRegion);
            if (fromLane < 0 || toLane < 0) return null;
            const fromEv = eventMap.get(c.from);
            const toEv = eventMap.get(c.to);
            if (!fromEv || !toEv) return null;
            const fromTs = fromEv.firstSeenAt ? new Date(fromEv.firstSeenAt).getTime() : timeRange.min;
            const toTs = toEv.firstSeenAt ? new Date(toEv.firstSeenAt).getTime() : timeRange.min;
            return (
              <line
                key={`corr-${ci}`}
                x1={xAt(fromTs)}
                y1={yAt(fromLane)}
                x2={xAt(toTs)}
                y2={yAt(toLane)}
                stroke="var(--cyan)"
                strokeWidth="1"
                opacity="0.35"
                data-testid={`correlation-line-${c.from}-${c.to}`}
              />
            );
          })}

          {/* Lane labels */}
          {lanes.map((lane, li) => (
            <text
              key={`label-${lane.region}`}
              x={LABEL_WIDTH + PAD_LEFT - 8}
              y={yAt(li) + 4}
              textAnchor="end"
              fontSize="10"
              fontFamily="var(--ff-mono)"
              fill="var(--ink-0)"
              letterSpacing="0.08em"
              data-testid={`lane-label-${lane.region}`}
            >
              {lane.region.toUpperCase()}
            </text>
          ))}

          {/* Event dots */}
          {lanes.map((lane, li) =>
            lane.events.map((ev) => {
              const ts = ev.firstSeenAt ? new Date(ev.firstSeenAt).getTime() : timeRange.min;
              const cx = xAt(ts);
              const cy = yAt(li);
              const isSelected = selectedEvent && selectedEvent.id === ev.id;
              const sevColor = severityColor(ev.severity ?? 0);
              return (
                <g
                  key={`dot-${ev.id}`}
                  data-testid={`event-dot-${ev.id}`}
                  style={{ cursor: 'pointer' }}
                  onClick={() => handleDotClick(ev)}
                >
                  {isSelected && (
                    <circle cx={cx} cy={cy} r={DOT_RADIUS + 3} fill="none" stroke="var(--ink-0)" strokeWidth="1.5" opacity="0.6" />
                  )}
                  <circle cx={cx} cy={cy} r={DOT_RADIUS} fill={sevColor} stroke="var(--bg-1)" strokeWidth="1" opacity="0.9" />
                </g>
              );
            })
          )}
        </svg>
      </div>

      {/* Empty state */}
      {lanes.length === 0 && (
        <div className="correlation-empty" data-testid="correlation-empty">
          <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 12, letterSpacing: '0.1em' }}>
            {t('correlation.noEvents')}
          </div>
          <div style={{ color: 'var(--ink-3)', fontSize: 11, marginTop: 4 }}>
            {t('correlation.noEventsHint')}
          </div>
        </div>
      )}

      {/* Selected event detail panel */}
      {selectedEvent && (
        <div className="correlation-detail" data-testid="correlation-detail">
          <div className="correlation-detail-header">
            <h4 className="mono" style={{ color: 'var(--ink-0)', margin: 0, fontSize: 13, letterSpacing: '0.06em' }}>
              {selectedEvent.title || t('correlation.untitledEvent')}
            </h4>
            <button
              type="button"
              className="btn"
              onClick={() => setSelectedEvent(null)}
              style={{ padding: '2px 8px', fontSize: 10 }}
              aria-label={t('correlation.closeDetail')}
            >
              ✕
            </button>
          </div>
          <div className="correlation-detail-meta">
            <div className="mono" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--ink-2)' }}>{t('correlation.region')}: </span>
              <span style={{ color: 'var(--ink-0)' }}>{selectedEvent.primaryCountry || selectedEvent.isoA2 || '—'}</span>
            </div>
            <div className="mono" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--ink-2)' }}>{t('article.severity')}: </span>
              <span style={{ color: severityColor(selectedEvent.severity ?? 0) }}>
                {Math.round(selectedEvent.severity ?? 0)}/100
              </span>
            </div>
            <div className="mono" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--ink-2)' }}>{t('article.category')}: </span>
              <span style={{ color: 'var(--ink-0)' }}>{selectedEvent.category || '—'}</span>
            </div>
            <div className="mono" style={{ fontSize: 10 }}>
              <span style={{ color: 'var(--ink-2)' }}>{t('timeline.lifecycle.label') || 'Lifecycle'}: </span>
              <span style={{ color: 'var(--ink-0)' }}>{selectedEvent.lifecycle || '—'}</span>
            </div>
            {selectedEvent.firstSeenAt && (
              <div className="mono" style={{ fontSize: 10 }}>
                <span style={{ color: 'var(--ink-2)' }}>{t('article.firstSeen')}: </span>
                <span style={{ color: 'var(--ink-0)' }}>
                  {formatCorrelationTimestamp(new Date(selectedEvent.firstSeenAt).getTime())}
                </span>
              </div>
            )}
          </div>
          <div className="correlation-detail-actions">
            <button
              type="button"
              className="btn primary"
              onClick={handleNavigateToEvent}
              data-testid="correlation-navigate-btn"
            >
              {t('correlation.goToEvent')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
