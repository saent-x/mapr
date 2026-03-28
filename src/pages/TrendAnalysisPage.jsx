import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { TrendingUp, BarChart3, Check, Loader } from 'lucide-react';
import useNewsStore from '../stores/newsStore.js';
import { fetchBackendCoverageHistoryWithRegions } from '../services/backendService.js';
import { format } from 'date-fns';

/* ── Region colors (10 distinct, high-contrast on dark bg) ── */
const REGION_COLORS = [
  '#00d4ff', '#ff5577', '#00e5a0', '#ffaa33', '#a78bfa',
  '#f472b6', '#38bdf8', '#fb923c', '#4ade80', '#e879f9',
];

function getRegionColor(index) {
  return REGION_COLORS[index % REGION_COLORS.length];
}

/* ── Tiny sparkline (inline SVG) ── */
function Sparkline({ counts, color, width = 80, height = 24 }) {
  if (!counts || counts.length < 2) return null;
  const max = Math.max(...counts, 1);
  const step = width / (counts.length - 1);
  const points = counts.map((v, i) => `${i * step},${height - (v / max) * height}`).join(' ');
  return (
    <svg width={width} height={height} className="trend-sparkline" aria-hidden="true">
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/* ── Main SVG area chart ── */
function TrendChart({ timestamps, regions, selectedRegions, width = 700, height = 340 }) {
  const { t } = useTranslation();
  const padding = { top: 20, right: 24, bottom: 36, left: 42 };
  const chartW = width - padding.left - padding.right;
  const chartH = height - padding.top - padding.bottom;

  const selected = useMemo(() => {
    return Object.entries(regions)
      .filter(([iso]) => selectedRegions.has(iso))
      .map(([iso, data], idx) => ({ iso, ...data, color: getRegionColor([...selectedRegions].indexOf(iso)) }));
  }, [regions, selectedRegions]);

  // Compute y-axis max across all selected regions
  const yMax = useMemo(() => {
    let max = 1;
    for (const r of selected) {
      for (const c of r.counts) { if (c > max) max = c; }
    }
    return Math.ceil(max * 1.1);
  }, [selected]);

  // x-scale: evenly spaced timestamps
  const xScale = useCallback((i) => padding.left + (timestamps.length > 1 ? (i / (timestamps.length - 1)) * chartW : chartW / 2), [timestamps, chartW, padding.left]);
  const yScale = useCallback((v) => padding.top + chartH - (v / yMax) * chartH, [yMax, chartH, padding.top]);

  // y-axis ticks (5 ticks)
  const yTicks = useMemo(() => {
    const ticks = [];
    const step = Math.max(1, Math.ceil(yMax / 5));
    for (let v = 0; v <= yMax; v += step) ticks.push(v);
    return ticks;
  }, [yMax]);

  // x-axis tick labels (max 8 labels)
  const xTickIndices = useMemo(() => {
    if (timestamps.length <= 8) return timestamps.map((_, i) => i);
    const step = Math.max(1, Math.floor((timestamps.length - 1) / 7));
    const indices = [];
    for (let i = 0; i < timestamps.length; i += step) indices.push(i);
    if (indices[indices.length - 1] !== timestamps.length - 1) indices.push(timestamps.length - 1);
    return indices;
  }, [timestamps]);

  // Hover state
  const [hoverIdx, setHoverIdx] = useState(null);

  if (timestamps.length === 0 || selected.length === 0) {
    return (
      <div className="trend-chart-empty">
        <BarChart3 size={32} />
        <span>{t('trends.noData')}</span>
      </div>
    );
  }

  return (
    <svg
      width={width}
      height={height}
      className="trend-chart-svg"
      role="img"
      aria-label={t('trends.chartAriaLabel')}
    >
      {/* Grid lines */}
      {yTicks.map((v) => (
        <line
          key={`grid-${v}`}
          x1={padding.left}
          y1={yScale(v)}
          x2={width - padding.right}
          y2={yScale(v)}
          stroke="rgba(226,232,240,0.06)"
          strokeDasharray="3,3"
        />
      ))}

      {/* Y-axis labels */}
      {yTicks.map((v) => (
        <text
          key={`y-${v}`}
          x={padding.left - 8}
          y={yScale(v) + 3}
          textAnchor="end"
          className="trend-chart-tick"
        >
          {v}
        </text>
      ))}

      {/* X-axis labels */}
      {xTickIndices.map((i) => (
        <text
          key={`x-${i}`}
          x={xScale(i)}
          y={height - 6}
          textAnchor="middle"
          className="trend-chart-tick"
        >
          {formatTimestamp(timestamps[i])}
        </text>
      ))}

      {/* Area fills (translucent) */}
      {selected.map((r) => {
        const d = `M${r.counts.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' L')} L${xScale(r.counts.length - 1)},${yScale(0)} L${xScale(0)},${yScale(0)} Z`;
        return (
          <path
            key={`area-${r.iso}`}
            d={d}
            fill={r.color}
            fillOpacity={0.08}
          />
        );
      })}

      {/* Line paths */}
      {selected.map((r) => {
        const d = `M${r.counts.map((v, i) => `${xScale(i)},${yScale(v)}`).join(' L')}`;
        return (
          <path
            key={`line-${r.iso}`}
            d={d}
            fill="none"
            stroke={r.color}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}

      {/* Data points */}
      {selected.map((r) =>
        r.counts.map((v, i) => (
          <circle
            key={`pt-${r.iso}-${i}`}
            cx={xScale(i)}
            cy={yScale(v)}
            r={hoverIdx === i ? 4 : 2.5}
            fill={r.color}
            stroke="var(--bg)"
            strokeWidth={1}
          />
        ))
      )}

      {/* Hover overlay rectangles */}
      {timestamps.map((_, i) => {
        const sliceW = timestamps.length > 1 ? chartW / (timestamps.length - 1) : chartW;
        return (
          <rect
            key={`hover-${i}`}
            x={xScale(i) - sliceW / 2}
            y={padding.top}
            width={sliceW}
            height={chartH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
            onMouseLeave={() => setHoverIdx(null)}
          />
        );
      })}

      {/* Hover line */}
      {hoverIdx !== null && (
        <line
          x1={xScale(hoverIdx)}
          y1={padding.top}
          x2={xScale(hoverIdx)}
          y2={padding.top + chartH}
          stroke="rgba(226,232,240,0.2)"
          strokeDasharray="4,3"
          pointerEvents="none"
        />
      )}

      {/* Hover tooltip */}
      {hoverIdx !== null && (
        <g pointerEvents="none">
          {selected.map((r, idx) => {
            const value = r.counts[hoverIdx] ?? 0;
            return (
              <text
                key={`tip-${r.iso}`}
                x={xScale(hoverIdx) + 8}
                y={yScale(value) + idx * 14 - (selected.length * 7) + 7}
                className="trend-chart-tooltip"
                fill={r.color}
              >
                {r.name}: {value}
              </text>
            );
          })}
        </g>
      )}
    </svg>
  );
}

function formatTimestamp(ts) {
  try {
    return format(new Date(ts), 'HH:mm');
  } catch {
    return ts?.slice(11, 16) || '';
  }
}

/**
 * Trend Analysis Dashboard — shows regional activity trends over time
 * with SVG line/area charts and region comparison controls.
 */
export default function TrendAnalysisPage() {
  const { t } = useTranslation();
  const { liveNews, backendEvents, velocitySpikes } = useNewsStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [trendData, setTrendData] = useState(null);
  const [selectedRegions, setSelectedRegions] = useState(new Set());

  /* ── Container dimensions ── */
  const [chartWidth, setChartWidth] = useState(700);
  const chartRef = React.useRef(null);

  useEffect(() => {
    const el = chartRef.current;
    if (!el) return;
    const measure = () => {
      const rect = el.getBoundingClientRect();
      setChartWidth(Math.max(300, Math.floor(rect.width)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ── Fetch data on mount ── */
  useEffect(() => {
    if (!liveNews) {
      useNewsStore.getState().loadLiveData();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetchBackendCoverageHistoryWithRegions({ limit: 48, topN: 20 })
      .then((data) => {
        if (cancelled) return;
        setTrendData(data);

        // Auto-select top 5 regions
        if (data?.regionSeries?.regions) {
          const top5 = Object.keys(data.regionSeries.regions).slice(0, 5);
          setSelectedRegions(new Set(top5));
        }
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err.message);
        setLoading(false);
      });

    return () => { cancelled = true; };
  }, []);

  /* ── Derive current regional stats from backend events ── */
  const regionStats = useMemo(() => {
    if (!backendEvents || backendEvents.length === 0) return [];
    const counts = {};
    for (const event of backendEvents) {
      const iso = event.isoA2 || event.primaryCountry;
      if (!iso) continue;
      if (!counts[iso]) {
        counts[iso] = { iso, region: event.region || iso, eventCount: 0, totalArticles: 0 };
      }
      counts[iso].eventCount += 1;
      counts[iso].totalArticles += event.articleCount || event.articleIds?.length || 1;
    }
    return Object.values(counts).sort((a, b) => b.eventCount - a.eventCount);
  }, [backendEvents]);

  /* ── Chart data ── */
  const regionSeries = trendData?.regionSeries || { timestamps: [], regions: {} };
  const sortedRegionIsos = useMemo(() => {
    return Object.entries(regionSeries.regions)
      .sort((a, b) => b[1].latestCount - a[1].latestCount)
      .map(([iso]) => iso);
  }, [regionSeries.regions]);

  /* ── Toggle region selection ── */
  const toggleRegion = useCallback((iso) => {
    setSelectedRegions((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) {
        next.delete(iso);
      } else if (next.size < 10) {
        next.add(iso);
      }
      return next;
    });
  }, []);

  const selectAll = useCallback(() => {
    setSelectedRegions(new Set(sortedRegionIsos.slice(0, 10)));
  }, [sortedRegionIsos]);

  const deselectAll = useCallback(() => {
    setSelectedRegions(new Set());
  }, []);

  /* ── Velocity spikes summary ── */
  const spikeCount = velocitySpikes?.length || 0;

  return (
    <div className="trend-analysis">
      {/* Header */}
      <div className="trend-analysis-header">
        <div className="trend-analysis-title-row">
          <TrendingUp size={20} />
          <h1 className="trend-analysis-title">{t('trends.title')}</h1>
          {!loading && regionStats.length > 0 && (
            <span className="trend-analysis-stats">
              {regionStats.length} {t('trends.activeRegions')}
              {spikeCount > 0 && ` · ${spikeCount} ${t('trends.spikes')}`}
            </span>
          )}
        </div>
        <p className="trend-analysis-subtitle">{t('trends.subtitle')}</p>
      </div>

      {/* Content */}
      <div className="trend-analysis-body">
        {loading ? (
          <div className="trend-chart-empty">
            <Loader size={24} className="trend-spinner" />
            <span>{t('trends.loading')}</span>
          </div>
        ) : error ? (
          <div className="trend-chart-empty">
            <BarChart3 size={32} />
            <span>{error}</span>
          </div>
        ) : (
          <>
            {/* Summary cards */}
            <div className="trend-summary-cards">
              <div className="trend-summary-card">
                <span className="trend-summary-label">{t('trends.totalEvents')}</span>
                <span className="trend-summary-value">{backendEvents?.length || 0}</span>
              </div>
              <div className="trend-summary-card">
                <span className="trend-summary-label">{t('trends.activeRegions')}</span>
                <span className="trend-summary-value">{regionStats.length}</span>
              </div>
              <div className="trend-summary-card">
                <span className="trend-summary-label">{t('trends.velocitySpikes')}</span>
                <span className="trend-summary-value trend-summary-value--spike">{spikeCount}</span>
              </div>
              <div className="trend-summary-card">
                <span className="trend-summary-label">{t('trends.dataPoints')}</span>
                <span className="trend-summary-value">{regionSeries.timestamps.length}</span>
              </div>
            </div>

            {/* Chart + region selector */}
            <div className="trend-chart-section">
              <div className="trend-chart-main" ref={chartRef}>
                <div className="trend-chart-header">
                  <h2 className="trend-section-title">{t('trends.chartTitle')}</h2>
                  <div className="trend-chart-actions">
                    <button className="trend-select-btn" onClick={selectAll}>{t('trends.selectTop10')}</button>
                    <button className="trend-select-btn" onClick={deselectAll}>{t('trends.deselectAll')}</button>
                  </div>
                </div>
                <TrendChart
                  timestamps={regionSeries.timestamps}
                  regions={regionSeries.regions}
                  selectedRegions={selectedRegions}
                  width={chartWidth}
                  height={340}
                />
              </div>

              {/* Region selector sidebar */}
              <div className="trend-region-list">
                <h3 className="trend-section-title">{t('trends.regions')}</h3>
                <ul className="trend-region-items">
                  {sortedRegionIsos.map((iso, idx) => {
                    const r = regionSeries.regions[iso];
                    const isSelected = selectedRegions.has(iso);
                    const color = isSelected ? getRegionColor([...selectedRegions].indexOf(iso)) : 'var(--text-tertiary)';
                    return (
                      <li key={iso} className="trend-region-item">
                        <button
                          className={`trend-region-btn ${isSelected ? 'is-active' : ''}`}
                          onClick={() => toggleRegion(iso)}
                          aria-pressed={isSelected}
                          style={isSelected ? { borderColor: color } : undefined}
                        >
                          <span className="trend-region-check" style={isSelected ? { background: color, borderColor: color } : undefined}>
                            {isSelected && <Check size={10} />}
                          </span>
                          <span className="trend-region-name">{r?.name || iso}</span>
                          <Sparkline counts={r?.counts} color={color} />
                          <span className="trend-region-count" style={isSelected ? { color } : undefined}>
                            {r?.latestCount || 0}
                          </span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              </div>
            </div>

            {/* Velocity spikes section */}
            {velocitySpikes && velocitySpikes.length > 0 && (
              <div className="trend-spikes-section">
                <h2 className="trend-section-title">{t('trends.velocitySpikesTitle')}</h2>
                <div className="trend-spikes-grid">
                  {velocitySpikes.map((spike) => (
                    <div
                      key={spike.iso}
                      className={`trend-spike-card trend-spike-card--${spike.level}`}
                    >
                      <span className="trend-spike-iso">{spike.iso}</span>
                      <span className="trend-spike-score">z={spike.zScore.toFixed(1)}</span>
                      <span className={`trend-spike-level trend-spike-level--${spike.level}`}>
                        {spike.level}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
