import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore.js';
import { canonicalizeArticles } from '../utils/newsPipeline.js';
import { isoToCountry } from '../utils/geocoder.js';

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

function buildRegionalSeries(news, topN = 5) {
  const byIso = new Map();
  for (const s of news) {
    if (!s.isoA2) continue;
    if (!byIso.has(s.isoA2)) byIso.set(s.isoA2, []);
    byIso.get(s.isoA2).push(s);
  }
  const rankedIsos = [...byIso.entries()]
    .sort((a, b) => b[1].length - a[1].length)
    .slice(0, topN)
    .map(([iso]) => iso);

  const BUCKETS = 30;
  const HOUR_MS = 3600 * 1000;
  const WINDOW = BUCKETS * 24 * HOUR_MS;
  const now = Date.now();

  return rankedIsos.map((iso, idx) => {
    const list = byIso.get(iso) || [];
    const bins = new Array(BUCKETS).fill(0);
    for (const art of list) {
      const ts = art.firstSeenAt ? new Date(art.firstSeenAt).getTime() : null;
      if (!ts) continue;
      const offset = now - ts;
      if (offset < 0 || offset > WINDOW) continue;
      const bucket = BUCKETS - 1 - Math.floor(offset / (24 * HOUR_MS));
      if (bucket >= 0 && bucket < BUCKETS) bins[bucket] += 1;
    }
    return {
      label: isoToCountry(iso) || iso,
      iso,
      data: bins,
      color: SERIES_COLORS[idx % SERIES_COLORS.length],
    };
  });
}

function buildByCategory(news, topN = 6) {
  const byCat = new Map();
  for (const s of news) {
    const cat = (s.category || 'other').toLowerCase();
    if (!byCat.has(cat)) byCat.set(cat, []);
    byCat.get(cat).push(s);
  }
  const cats = [...byCat.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, topN);
  const BUCKETS = 14;
  const now = Date.now();
  const DAY = 24 * 3600 * 1000;
  return cats.map(([cat, list], idx) => {
    const bins = new Array(BUCKETS).fill(0);
    for (const art of list) {
      const ts = art.firstSeenAt ? new Date(art.firstSeenAt).getTime() : null;
      if (!ts) continue;
      const offset = now - ts;
      if (offset < 0 || offset > BUCKETS * DAY) continue;
      const bucket = BUCKETS - 1 - Math.floor(offset / DAY);
      if (bucket >= 0 && bucket < BUCKETS) bins[bucket] += 1;
    }
    return { label: cat.toUpperCase(), data: bins, color: SERIES_COLORS[idx % SERIES_COLORS.length] };
  });
}

function buildLangMix(news) {
  const byLang = {};
  for (const s of news) {
    const l = (s.language || 'en').toLowerCase();
    byLang[l] = (byLang[l] || 0) + 1;
  }
  const total = Object.values(byLang).reduce((a, b) => a + b, 0) || 1;
  return Object.entries(byLang)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([l, c]) => ({ l: l.toUpperCase(), pct: Math.round((c / total) * 100) }));
}

/**
 * /trends — tactical trend dashboard built from the current news pool.
 */
export default function TrendAnalysisPage() {
  const { t } = useTranslation();
  const liveNews = useNewsStore((s) => s.liveNews);

  useEffect(() => {
    if (!liveNews) useNewsStore.getState().loadLiveData();
  }, [liveNews]);

  const news = useMemo(() => canonicalizeArticles(liveNews || []), [liveNews]);

  const regional = useMemo(() => buildRegionalSeries(news, 5), [news]);
  const byCat = useMemo(() => buildByCategory(news, 6), [news]);
  const langMix = useMemo(() => buildLangMix(news), [news]);

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
      <div className="trend-card span-2">
        <div className="head">
          <h3>{t('nav.trends')} · volume by region · 30d</h3>
          <div className="mono">Δ window: <b style={{ color: 'var(--amber)' }}>30D / 24H BUCKETS</b></div>
        </div>
        <div className="body" style={{ position: 'relative' }}>
          {regional.length === 0 ? (
            <div className="mini-panel-empty" style={{ padding: 40 }}>NO DATA IN WINDOW</div>
          ) : (
            <>
              <TrendLineChart series={regional} h={260} />
              <div
                style={{
                  position: 'absolute', top: 20, right: 24,
                  display: 'flex', gap: 14, flexWrap: 'wrap',
                  fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em',
                }}
              >
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

      <div className="trend-card span-2">
        <div className="head">
          <h3>Severity distribution · by category · 14d</h3>
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
    </div>
  );
}
