import React, { lazy, Suspense, useCallback, useEffect, useMemo } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';
import { canonicalizeArticles } from '../utils/newsPipeline.js';
import { buildRegionalSeries, buildByCategory, buildSourceVelocity, buildSeverityDistribution, buildLangMix } from '../utils/trendBuilders.js';

const StoryThreadsPanel = lazy(() => import('../components/StoryThreadsPanel.jsx'));

const VALID_RANGES = ['7d', '30d', '90d'];
const DEFAULT_RANGE = '30d';
const VALID_TABS = ['charts', 'threads'];
const DEFAULT_TAB = 'charts';

const SERIES_COLORS = ['var(--amber)', 'var(--cyan)', 'var(--sev-red)', 'var(--sev-green)', 'var(--sev-amber)'];

function TrendLineChart({ series, w = 640, h = 240, area = false }) {
  if (!series.length) return null;
  const len = Math.max(...series.map((s) => s.data.length));
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  const pad = { l: 44, r: 12, t: 16, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (i / Math.max(1, len - 1)) * iw;
  const yAt = (v) => pad.t + ih - (v / max) * ih;
  const gridY = 5;
  return (
    <svg width={w} height={h} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Trend chart">
      {Array.from({ length: gridY + 1 }).map((_, i) => (
        <g key={i}>
          <line
            x1={pad.l} x2={w - pad.r}
            y1={pad.t + (i * ih) / gridY} y2={pad.t + (i * ih) / gridY}
            stroke="var(--line)" strokeWidth="0.5"
          />
          <text
            x={pad.l - 6} y={pad.t + (i * ih) / gridY + 3}
            fontSize="9" fill="var(--ink-2)" textAnchor="end"
            fontFamily="var(--ff-mono)"
          >
            {Math.round(max - (i * max) / gridY)}
          </text>
        </g>
      ))}
      {series.map((s, si) => {
        const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
        const pts = s.data.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' ');
        if (area) {
          const areaD = `M${xAt(0)},${yAt(0)} L${s.data.map((v, i) => `${xAt(i)},${yAt(v)}`).join(' L')} L${xAt(s.data.length - 1)},${yAt(0)} Z`;
          return (
            <g key={si}>
              <path d={areaD} fill={color} opacity="0.15" />
              <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />
            </g>
          );
        }
        return <polyline key={si} points={pts} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke" />;
      })}
    </svg>
  );
}

function HorizonChart({ series, w = 640, h = 200 }) {
  if (!series.length) return null;
  const row = (h - 20) / series.length;
  const pad = 100;
  const iw = w - pad;
  const max = Math.max(1, ...series.flatMap((s) => s.data));
  return (
    <svg width={w} height={h} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Horizon chart">
      {series.map((s, si) => {
        const y0 = 10 + si * row + row;
        const color = s.color || SERIES_COLORS[si % SERIES_COLORS.length];
        return (
          <g key={s.label}>
            <text x={pad - 10} y={y0 - row / 2 + 3} fontSize="10" fill="var(--ink-0)" textAnchor="end" fontFamily="var(--ff-mono)">
              {s.label}
            </text>
            <line x1={pad} x2={w} y1={y0} y2={y0} stroke="var(--line)" strokeWidth="0.4" />
            {s.data.map((v, i) => {
              const x = pad + (i / Math.max(1, s.data.length - 1)) * iw;
              const bw = iw / s.data.length;
              const hh = (v / max) * (row - 4);
              return <rect key={i} x={x} y={y0 - hh} width={bw - 1} height={hh} fill={color} opacity="0.9" />;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function DonutChart({ data, size = 160, eventsLabel = 'EVENTS' }) {
  if (!data.length) return null;
  const total = data.reduce((a, d) => a + d.count, 0) || 1;
  const cx = size / 2, cy = size / 2, r = size / 2 - 8, inner = r * 0.55;
  let acc = 0;
  const arcs = data.filter((d) => d.count > 0).map((d) => {
    const start = acc / total;
    acc += d.count;
    const end = acc / total;
    const large = end - start > 0.5 ? 1 : 0;
    const a0 = start * 2 * Math.PI - Math.PI / 2;
    const a1 = end * 2 * Math.PI - Math.PI / 2;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const ix0 = cx + inner * Math.cos(a1), iy0 = cy + inner * Math.sin(a1);
    const ix1 = cx + inner * Math.cos(a0), iy1 = cy + inner * Math.sin(a0);
    const path = `M${x0},${y0} A${r},${r} 0 ${large} 1 ${x1},${y1} L${ix0},${iy0} A${inner},${inner} 0 ${large} 0 ${ix1},${iy1} Z`;
    return { path, color: d.color, label: d.label, count: d.count, pct: d.pct };
  });
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 20 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Severity distribution">
        {arcs.map((a, i) => (
          <path key={i} d={a.path} fill={a.color} opacity="0.85" stroke="var(--bg-1)" strokeWidth="1.5" />
        ))}
        <text x={cx} y={cy - 6} textAnchor="middle" fontSize="16" fontFamily="var(--ff-mono)" fontWeight="600" fill="var(--ink-0)">{total}</text>
        <text x={cx} y={cy + 10} textAnchor="middle" fontSize="9" fontFamily="var(--ff-mono)" letterSpacing="0.1em" fill="var(--ink-2)">{eventsLabel}</text>
      </svg>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {data.map((d) => (
          <div key={d.key} style={{ display: 'flex', alignItems: 'center', gap: 6, fontFamily: 'var(--ff-mono)', fontSize: 10 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: d.color, flexShrink: 0 }} />
            <span style={{ color: 'var(--ink-1)', letterSpacing: '0.08em', minWidth: 56 }}>{d.label}</span>
            <span style={{ color: 'var(--ink-0)', fontWeight: 500, minWidth: 28, textAlign: 'right' }}>{d.count}</span>
            <span style={{ color: 'var(--ink-2)', fontSize: 9 }}>{d.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function VelocityChart({ data, w = 320, h = 160, bucketHrs = 2, nowLabel = 'NOW', daysUnit = 'd', hoursUnit = 'h' }) {
  const max = Math.max(1, ...data);
  const pad = { l: 32, r: 12, t: 16, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const barW = iw / data.length - 2;
  const xAt = (i) => pad.l + (i / data.length) * iw;
  const yAt = (v) => pad.t + ih - (v / max) * ih;
  const now = Date.now();
  return (
    <svg width={w} height={h} style={{ display: 'block', width: '100%' }} viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Source velocity">
      {Array.from({ length: 4 }).map((_, i) => (
        <g key={i}>
          <line x1={pad.l} x2={w - pad.r} y1={pad.t + (i * ih) / 3} y2={pad.t + (i * ih) / 3} stroke="var(--line)" strokeWidth="0.5" />
          <text x={pad.l - 6} y={pad.t + (i * ih) / 3 + 3} fontSize="9" fill="var(--ink-2)" textAnchor="end" fontFamily="var(--ff-mono)">
            {Math.round(max - (i * max) / 3)}
          </text>
        </g>
      ))}
      {data.map((v, i) => {
        const x = xAt(i) + 1;
        const bh = (v / max) * ih;
        const hrsAgo = (data.length - 1 - i) * bucketHrs;
        const label = hrsAgo === 0 ? nowLabel : hrsAgo >= 24 ? `${Math.round(hrsAgo / 24)}${daysUnit}` : `${hrsAgo}${hoursUnit}`;
        const isRecent = i >= data.length - 3;
        return (
          <g key={i}>
            <rect x={x} y={yAt(v)} width={barW} height={bh} fill={isRecent ? 'var(--amber)' : 'var(--ink-3)'} opacity={isRecent ? '0.9' : '0.6'} />
            {i % 2 === 0 && (
              <text x={x + barW / 2} y={h - 6} fontSize="8" fill="var(--ink-2)" textAnchor="middle" fontFamily="var(--ff-mono)">
                {label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

/**
 * /trends — tactical trend dashboard built from the current news pool.
 * Time range (7d / 30d / 90d) persisted in URL param `range`.
 */
export default function TrendAnalysisPage() {
  const { t } = useTranslation();
  const [searchParams, setSearchParams] = useSearchParams();
  const liveNews = useNewsStore((s) => s.liveNews);

  useEffect(() => {
    if (!liveNews) useNewsStore.getState().loadLiveData();
  }, [liveNews]);

  // Time range from URL params; default to 30d.
  const rangeParam = searchParams.get('range');
  const range = VALID_RANGES.includes(rangeParam) ? rangeParam : DEFAULT_RANGE;
  const rangeDays = parseInt(range, 10);

  // Tab from URL params; default to charts.
  const tabParam = searchParams.get('tab');
  const tab = VALID_TABS.includes(tabParam) ? tabParam : DEFAULT_TAB;

  // Entity prefilter from URL params (set by EntityExplorerPage's "Show Timeline" button).
  const entityParam = searchParams.get('entity') || '';

  // Sync URL if range param is missing or invalid.
  useEffect(() => {
    if (!VALID_RANGES.includes(rangeParam)) {
      const next = new URLSearchParams(searchParams);
      next.set('range', DEFAULT_RANGE);
      setSearchParams(next, { replace: true });
    }
  }, [rangeParam, searchParams, setSearchParams]);

  const handleRangeChange = (newRange) => {
    const next = new URLSearchParams(searchParams);
    next.set('range', newRange);
    setSearchParams(next, { replace: true });
  };

  const handleTabChange = (newTab) => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', newTab);
    setSearchParams(next, { replace: true });
  };

  /* ── Keyboard navigation (basic: ? for help, Escape to go back, / for search) ── */
  const navigate = useNavigate();

  useKeyboardNavigation({
    items: [],
    searchSelector: '.search-input, .header-search input',
    onEscape: useCallback(() => {
      navigate('/');
      return true;
    }, [navigate]),
    onHelp: useCallback(() => {
      window.dispatchEvent(new CustomEvent('mapr:openShortcutHelp'));
    }, []),
  });

  // Filter news to only include articles within the selected time range.
  const cutoff = Date.now() - rangeDays * 24 * 3600 * 1000;
  const news = useMemo(() => {
    const articles = canonicalizeArticles(liveNews || []);
    return articles.filter((a) => {
      const ts = a.firstSeenAt ? new Date(a.firstSeenAt).getTime() : null;
      return ts && ts >= cutoff;
    });
  }, [liveNews, cutoff]);

  const regional = useMemo(() => buildRegionalSeries(news, 5, rangeDays), [news, rangeDays]);
  const byCat = useMemo(() => buildByCategory(news, 6, rangeDays), [news, rangeDays]);
  const langMix = useMemo(() => buildLangMix(news), [news]);
  const severityDist = useMemo(() => buildSeverityDistribution(news), [news]);
  const velocity = useMemo(() => buildSourceVelocity(news, 2, rangeDays), [news, rangeDays]);

  const topEntities = useMemo(() => {
    const counter = new Map();
    const KIND_LABEL = { people: 'PER', organizations: 'ORG', locations: 'LOC' };
    for (const s of news) {
      const ents = s.entities;
      if (!ents) continue;
      for (const kind of ['organizations', 'locations', 'people']) {
        for (const item of ents[kind] || []) {
          const name = typeof item === 'string' ? item : (item?.name || '');
          if (!name) continue;
          const key = `${KIND_LABEL[kind]}|${name}`;
          counter.set(key, (counter.get(key) || 0) + 1);
        }
      }
    }
    return [...counter.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([key, n]) => {
        const [kind, name] = key.split('|');
        return { kind, name, count: n };
      });
  }, [news]);

  return (
    <div className="trends-page">
      {/* Tab bar */}
      <div className="trends-tab-bar" role="tablist" aria-label={t('trends.tabAriaLabel') || t('nav.trends')}>
        {VALID_TABS.map((tv) => (
          <button
            key={tv}
            role="tab"
            className="trends-tab"
            data-active={tab === tv ? 'true' : 'false'}
            aria-selected={tab === tv}
            onClick={() => handleTabChange(tv)}
          >
            {t(`trends.tab${tv.charAt(0).toUpperCase() + tv.slice(1)}`)}
          </button>
        ))}
      </div>

      {/* Story Threads tab */}
      {tab === 'threads' && (
        <Suspense fallback={<div className="trend-card"><div className="body" style={{ padding: 40 }}>{t('loading.page')}</div></div>}>
          <StoryThreadsPanel prefilterEntity={entityParam} />
        </Suspense>
      )}

      {/* Charts tab */}
      {tab === 'charts' && (
      <>
      {/* Time range toggle */}
      <div className="trends-range-toggle" role="group" aria-label={t('trends.timeRangeLabel')}>
        <span className="trends-range-label mono">{t('trends.timeRangeLabel')}</span>
        {VALID_RANGES.map((r) => (
          <button
            key={r}
            className="toggle-chip"
            data-active={range === r ? 'true' : 'false'}
            onClick={() => handleRangeChange(r)}
            aria-pressed={range === r}
          >
            {t(`trends.timeRange${r}`)}
          </button>
        ))}
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>{t('nav.trends')} · volume by region · {range}</h3>
          <div className="mono">Δ window: <b style={{ color: 'var(--amber)' }}>{range.toUpperCase()} / {(rangeDays <= 7 ? '24H' : '1D')} BUCKETS</b></div>
        </div>
        <div className="body" style={{ position: 'relative' }}>
          {regional.length === 0 ? (
            <div className="mini-panel-empty" style={{ padding: 40 }}>NO DATA IN WINDOW</div>
          ) : (
            <>
              <TrendLineChart series={regional} h={260} />
              <div className="trend-chart-legend">
                {regional.map((s) => (
                  <span key={s.iso}>
                    <span style={{ display: 'inline-block', width: 10, height: 2, background: s.color, verticalAlign: 'middle', marginRight: 4 }} />
                    {s.label.toUpperCase()}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>Severity distribution · by category · {range}</h3>
          <div className="mono">HORIZON</div>
        </div>
        <div className="body">
          {byCat.length === 0 ? (
            <div className="mini-panel-empty" style={{ padding: 40 }}>NO CATEGORY DATA</div>
          ) : (
            <HorizonChart series={byCat} h={200} />
          )}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>{t('trends.sourceVelocityHeading', { bucket: rangeDays <= 1 ? '2h' : rangeDays <= 7 ? '14h' : '72h' })}</h3>
          <div className="mono">{rangeDays <= 1 ? t('trends.rolling24h') : rangeDays <= 7 ? t('trends.rolling7d') : t('trends.buckets3d')}</div>
        </div>
        <div className="body">
          {velocity.length === 0 ? (
            <div className="mini-panel-empty" style={{ padding: 40 }}>{t('trends.noVelocityData')}</div>
          ) : (
            <VelocityChart
              data={velocity}
              bucketHrs={rangeDays <= 1 ? 2 : rangeDays <= 7 ? 14 : 72}
              nowLabel={t('trends.nowLabel')}
              daysUnit={t('trends.daysUnit')}
              hoursUnit={t('trends.hoursUnit')}
            />
          )}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>{t('trends.severityTierBreakdown')}</h3>
          <div className="mono">CURRENT</div>
        </div>
        <div className="body">
          {severityDist.every((d) => d.count === 0) ? (
            <div className="mini-panel-empty" style={{ padding: 40 }}>{t('trends.noSeverityData')}</div>
          ) : (
            <DonutChart data={severityDist} eventsLabel={t('trends.eventsLabel')} />
          )}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>Language mix · news feed</h3>
          <div className="mono">CURRENT</div>
        </div>
        <div className="body">
          {langMix.map(({ l, pct }) => (
            <div key={l} style={{ display: 'grid', gridTemplateColumns: '40px 1fr 32px', alignItems: 'center', gap: 8, margin: '6px 0' }}>
              <span className="mono" style={{ color: 'var(--ink-1)', fontSize: 11 }}>{l}</span>
              <div style={{ height: 10, background: 'var(--bg-2)' }}>
                <div style={{ height: '100%', width: `${pct}%`, background: 'var(--amber)', transition: 'width 0.3s var(--ease)' }} />
              </div>
              <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, textAlign: 'right' }}>{pct}%</span>
            </div>
          ))}
          {langMix.length === 0 && <div className="mini-panel-empty">NO LANGUAGE DATA</div>}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>Top trending entities</h3>
          <div className="mono">CURRENT</div>
        </div>
        <div className="body">
          {topEntities.length === 0 && <div className="mini-panel-empty">NO ENTITIES EXTRACTED</div>}
          {topEntities.map((row) => (
            <div
              key={`${row.kind}-${row.name}`}
              style={{
                display: 'grid', gridTemplateColumns: '36px 1fr 60px',
                alignItems: 'center', padding: '6px 0',
                borderBottom: '1px solid var(--line)',
                fontFamily: 'var(--ff-mono)', fontSize: 11,
              }}
            >
              <span style={{ color: 'var(--ink-2)', fontSize: 10 }}>{row.kind}</span>
              <span style={{ color: 'var(--ink-0)', fontFamily: 'var(--ff-sans)', fontSize: 12 }}>{row.name}</span>
              <span style={{ color: 'var(--amber)', textAlign: 'right' }}>×{row.count}</span>
            </div>
          ))}
        </div>
      </div>
      </>
      )}
    </div>
  );
}
