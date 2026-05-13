import React, { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Search, X, ChevronDown } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import { isoToCountry } from '../utils/geocoder';
import { canonicalizeArticles } from '../utils/newsPipeline';
import {
  buildSeverityTrend,
  buildSharedEntityEvidence,
  summarizeRegionArticles,
} from '../utils/regionComparison';

/* ── helpers ── */

function sevTier(sev) {
  const v = sev ?? 0;
  if (v >= 85) return 'black';
  if (v >= 70) return 'red';
  if (v >= 40) return 'amber';
  return 'green';
}

/* ── Region selector dropdown ── */

function RegionSelector({ value, onChange, excludeIso, t }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const ref = useRef(null);

  const liveNews = useNewsStore((s) => s.liveNews);

  const regions = useMemo(() => {
    const byIso = new Map();
    for (const story of liveNews || []) {
      const k = story.isoA2;
      if (!k || k === excludeIso?.toUpperCase()) continue;
      const cur = byIso.get(k) || { iso: k, name: isoToCountry(k) || k, count: 0 };
      cur.count += 1;
      byIso.set(k, cur);
    }
    const list = [...byIso.values()];
    list.sort((a, b) => b.count - a.count);
    return list;
  }, [liveNews, excludeIso]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter(
      (r) => r.iso.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [regions, query]);

  // Close on outside click
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    if (open) document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const selectedName = value ? (isoToCountry(value) || value) : '';

  return (
    <div className="compare-region-selector" ref={ref}>
      <button
        type="button"
        className="compare-region-selector-trigger"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
      >
        <span className={selectedName ? '' : 'placeholder'}>
          {selectedName || t('regionDetail.selectSecondRegion')}
        </span>
        <ChevronDown size={12} aria-hidden />
      </button>
      {open && (
        <div className="compare-region-selector-dropdown" role="listbox">
          <div className="compare-region-selector-search">
            <Search size={12} aria-hidden />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('regionDetail.searchRegionPlaceholder')}
              aria-label={t('regionDetail.searchRegionPlaceholder')}
              autoFocus
            />
          </div>
          <div className="compare-region-selector-list">
            {filtered.length === 0 && (
              <div className="compare-region-selector-empty">NO REGIONS</div>
            )}
            {filtered.map((r) => (
              <button
                key={r.iso}
                type="button"
                className={`compare-region-selector-option${value === r.iso ? ' selected' : ''}`}
                role="option"
                aria-selected={value === r.iso}
                onClick={() => {
                  onChange(r.iso);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span className="compare-region-selector-iso">{r.iso}</span>
                <span className="compare-region-selector-name">{r.name}</span>
                <span className="compare-region-selector-count">{r.count}</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Dual-line severity trend chart (SVG) ── */

const COLORS = ['var(--amber)', 'var(--cyan)'];

function DualSeverityChart({ seriesA, seriesB, labelA, labelB, w = 560, h = 200 }) {
  if (!seriesA.length && !seriesB.length) return null;

  const all = [...seriesA, ...seriesB];
  const len = Math.max(seriesA.length, seriesB.length);
  const maxVal = Math.max(1, ...all.map((d) => d.value));
  const pad = { l: 48, r: 16, t: 12, b: 28 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (i / Math.max(1, len - 1)) * iw;
  const yAt = (v) => pad.t + ih - (v / maxVal) * ih;
  const gridY = 4;

  const buildLine = (series, si) => {
    if (!series.length) return null;
    const color = COLORS[si];
    const pts = series.map((d, i) => `${xAt(i)},${yAt(d.value)}`).join(' ');
    return (
      <g key={si}>
        <polyline
          points={pts}
          fill="none"
          stroke={color}
          strokeWidth="1.3"
          vectorEffect="non-scaling-stroke"
        />
        {series.map((d, i) => (
          <circle
            key={i}
            cx={xAt(i)}
            cy={yAt(d.value)}
            r="2.5"
            fill={color}
            opacity="0.9"
          >
            <title>{`${si === 0 ? labelA : labelB}: ${d.date} — ${d.value.toFixed(1)}`}</title>
          </circle>
        ))}
      </g>
    );
  };

  return (
    <div className="compare-dual-chart">
      <svg
        width={w}
        height={h}
        style={{ display: 'block', width: '100%' }}
        viewBox={`0 0 ${w} ${h}`}
        role="img"
        aria-label="Dual severity trend chart"
      >
        {/* Grid lines */}
        {Array.from({ length: gridY + 1 }).map((_, i) => (
          <g key={i}>
            <line
              x1={pad.l}
              x2={w - pad.r}
              y1={pad.t + (i * ih) / gridY}
              y2={pad.t + (i * ih) / gridY}
              stroke="var(--line)"
              strokeWidth="0.5"
            />
            <text
              x={pad.l - 6}
              y={pad.t + (i * ih) / gridY + 3}
              fontSize="8"
              fill="var(--ink-2)"
              textAnchor="end"
              fontFamily="var(--ff-mono)"
            >
              {((maxVal - (i * maxVal) / gridY)).toFixed(1)}
            </text>
          </g>
        ))}
        {/* Lines */}
        {buildLine(seriesA, 0)}
        {buildLine(seriesB, 1)}
      </svg>
      {/* Legend */}
      <div className="compare-dual-chart-legend">
        <span className="compare-legend-item">
          <span className="compare-legend-swatch" style={{ background: COLORS[0] }} />
          {labelA}
        </span>
        <span className="compare-legend-item">
          <span className="compare-legend-swatch" style={{ background: COLORS[1] }} />
          {labelB}
        </span>
      </div>
    </div>
  );
}

/* ── Main ComparativeRegions component ── */

export default function ComparativeRegions({ isoA, isoB, onRegionBChange, onExit }) {
  const { t } = useTranslation();

  const liveNews = useNewsStore((s) => s.liveNews);
  const regionBackfills = useNewsStore((s) => s.regionBackfills);

  // Build article lists for both regions
  const canonicalNews = useMemo(() => canonicalizeArticles(liveNews || []), [liveNews]);

  const regionAData = useMemo(() => {
    const upper = isoA?.toUpperCase();
    const liveForRegion = canonicalNews.filter((s) => s.isoA2 === upper);
    const backfillEvents = regionBackfills?.[upper]?.events || [];
    return liveForRegion.length > 0 ? liveForRegion : backfillEvents;
  }, [canonicalNews, regionBackfills, isoA]);

  const regionBData = useMemo(() => {
    if (!isoB) return [];
    const upper = isoB.toUpperCase();
    const liveForRegion = canonicalNews.filter((s) => s.isoA2 === upper);
    const backfillEvents = regionBackfills?.[upper]?.events || [];
    return liveForRegion.length > 0 ? liveForRegion : backfillEvents;
  }, [canonicalNews, regionBackfills, isoB]);

  // Stats
  const statsA = useMemo(() => summarizeRegionArticles(regionAData), [regionAData]);
  const statsB = useMemo(() => summarizeRegionArticles(regionBData), [regionBData]);

  // Build severity trends
  const trendA = useMemo(() => buildSeverityTrend(regionAData, 30), [regionAData]);
  const trendB = useMemo(() => buildSeverityTrend(regionBData, 30), [regionBData]);

  // Shared entity evidence, filtered to remove broad global entities and ranked
  // by event count, source coverage, recency, and severity.
  const sharedEntityEvidence = useMemo(
    () => buildSharedEntityEvidence(regionAData, regionBData),
    [regionAData, regionBData],
  );

  const countryNameA = isoToCountry(isoA?.toUpperCase()) || isoA?.toUpperCase() || '?';
  const countryNameB = isoB ? (isoToCountry(isoB.toUpperCase()) || isoB.toUpperCase()) : '';

  return (
    <div className="comparative-regions">
      {/* Header with region selector */}
      <div className="compare-header">
        <div className="compare-header-row">
          <div className="compare-header-label">{t('regionDetail.severityTrend')}</div>
          <button type="button" className="compare-exit-btn" onClick={onExit} aria-label={t('regionDetail.compareExit')}>
            <X size={14} aria-hidden />
            <span>{t('regionDetail.compareExit')}</span>
          </button>
        </div>
      </div>

      {/* Side-by-side stats */}
      <div className="compare-stats-row">
        <div className="compare-stats-panel">
          <div className="compare-stats-region-label">{countryNameA} <span className="compare-stats-iso">({isoA?.toUpperCase()})</span></div>
          <div className="compare-stats-grid">
            <div className="compare-stat">
              <span className="compare-stat-label">{t('regionDetail.avgSeverityShort')}</span>
              <span className={`compare-stat-val ${sevTier(statsA.avgSev * 10) === 'red' || sevTier(statsA.avgSev * 10) === 'black' ? 'sev-red' : sevTier(statsA.avgSev * 10) === 'amber' ? 'sev-amber' : ''}`}>
                {statsA.avgSev.toFixed(2)}
              </span>
            </div>
            <div className="compare-stat">
              <span className="compare-stat-label">{t('regionDetail.eventCount')}</span>
              <span className="compare-stat-val">{statsA.eventCount}</span>
            </div>
            <div className="compare-stat">
              <span className="compare-stat-label">{t('regionDetail.sourceCount')}</span>
              <span className="compare-stat-val">{statsA.sourceCount}</span>
            </div>
            <div className="compare-stat">
              <span className="compare-stat-label">{t('regionDetail.criticalCount', 'Critical')}</span>
              <span className="compare-stat-val sev-red">{statsA.criticalCount}</span>
            </div>
          </div>
        </div>

        <div className="compare-stats-divider" />

        <div className="compare-stats-panel">
          <div className="compare-stats-region-label">
            {isoB ? (
              <>{countryNameB} <span className="compare-stats-iso">({isoB.toUpperCase()})</span></>
            ) : (
              <span className="compare-stats-placeholder">{t('regionDetail.selectSecondRegion')}</span>
            )}
          </div>
          {isoB ? (
            <div className="compare-stats-grid">
              <div className="compare-stat">
                <span className="compare-stat-label">{t('regionDetail.avgSeverityShort')}</span>
                <span className={`compare-stat-val ${sevTier(statsB.avgSev * 10) === 'red' || sevTier(statsB.avgSev * 10) === 'black' ? 'sev-red' : sevTier(statsB.avgSev * 10) === 'amber' ? 'sev-amber' : ''}`}>
                  {statsB.avgSev.toFixed(2)}
                </span>
              </div>
              <div className="compare-stat">
                <span className="compare-stat-label">{t('regionDetail.eventCount')}</span>
                <span className="compare-stat-val">{statsB.eventCount}</span>
              </div>
              <div className="compare-stat">
                <span className="compare-stat-label">{t('regionDetail.sourceCount')}</span>
                <span className="compare-stat-val">{statsB.sourceCount}</span>
              </div>
              <div className="compare-stat">
                <span className="compare-stat-label">{t('regionDetail.criticalCount', 'Critical')}</span>
                <span className="compare-stat-val sev-red">{statsB.criticalCount}</span>
              </div>
            </div>
          ) : (
            <div className="compare-stats-grid">
              <div className="compare-stat is-empty">
                <span className="compare-stat-label">{t('regionDetail.avgSeverityShort')}</span>
                <span className="compare-stat-val">—</span>
              </div>
              <div className="compare-stat is-empty">
                <span className="compare-stat-label">{t('regionDetail.eventCount')}</span>
                <span className="compare-stat-val">—</span>
              </div>
              <div className="compare-stat is-empty">
                <span className="compare-stat-label">{t('regionDetail.sourceCount')}</span>
                <span className="compare-stat-val">—</span>
              </div>
              <div className="compare-stat is-empty">
                <span className="compare-stat-label">{t('regionDetail.criticalCount', 'Critical')}</span>
                <span className="compare-stat-val">—</span>
              </div>
            </div>
          )}
          <div className="compare-region-selector-wrap">
            <RegionSelector
              value={isoB}
              onChange={onRegionBChange}
              excludeIso={isoA}
              t={t}
            />
          </div>
        </div>
      </div>

      {/* Dual-line chart */}
      {isoB && (
        <DualSeverityChart
          seriesA={trendA}
          seriesB={trendB}
          labelA={`${countryNameA} (${isoA?.toUpperCase()})`}
          labelB={`${countryNameB} (${isoB.toUpperCase()})`}
        />
      )}

      {/* Shared entity evidence */}
      {isoB && (
        <div className="compare-shared-entities">
          <div className="compare-shared-entities-head">
            <span className="micro">{t('regionDetail.sharedEntities')}</span>
            <span className="compare-shared-entities-count">{sharedEntityEvidence.length}</span>
          </div>
          <p className="compare-evidence-note">
            {t('regionDetail.sharedEntitiesHint', 'Shared means the same typed entity appears in both countries after removing broad global organizations.')}
          </p>
          {sharedEntityEvidence.length > 0 ? (
            <div className="compare-shared-entities-list">
              {sharedEntityEvidence.map((entity) => (
                <div key={entity.key} className="compare-shared-entity-card">
                  <div className="compare-shared-entity-card-head">
                    <span className="compare-shared-entity-tag">{entity.name}</span>
                    <span className="compare-shared-entity-type">{entity.type}</span>
                  </div>
                  <div className="compare-shared-entity-meta">
                    <span>{countryNameA}: {entity.leftCount}</span>
                    <span>{countryNameB}: {entity.rightCount}</span>
                    <span>{entity.sourceCount} {t('regionDetail.sourcesShort', 'src')}</span>
                  </div>
                  {entity.evidenceTitles[0] && (
                    <div className="compare-shared-entity-evidence">{entity.evidenceTitles[0]}</div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div className="compare-shared-entities-empty">
              {t('regionDetail.noSharedEntities')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
