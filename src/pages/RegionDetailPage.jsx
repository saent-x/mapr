import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, Search, MapPin, Loader } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import { isoToCountry } from '../utils/geocoder';
import { sortStories, storyMatchesFilters } from '../utils/storyFilters';
import { canonicalizeArticles } from '../utils/newsPipeline';
import { resolveDateFloor } from '../utils/mockData';
import { getSourceHost } from '../utils/urlUtils';
import MapLoadingFallback from '../components/MapLoadingFallback';
import { ArticleSheet } from '../components/NewsPanel';

const FlatMap = lazy(() => import('../components/FlatMap'));

function ago(ts) {
  if (!ts) return '—';
  const dt = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  const m = Math.floor((Date.now() - dt) / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m / 60)}h`;
  return `${Math.floor(m / 1440)}d`;
}

function sevTier(sev) {
  const v = sev ?? 0;
  if (v >= 85) return 'black';
  if (v >= 70) return 'red';
  if (v >= 40) return 'amber';
  return 'green';
}

function lifecycleMeta(lifecycle) {
  if (!lifecycle) return null;
  const map = {
    emerging:    { label: 'EMERGING',    color: 'var(--cyan)' },
    developing:  { label: 'DEVELOPING',  color: 'var(--amber)' },
    escalating:  { label: 'ESCALATING',  color: 'var(--sev-red)' },
    stabilizing: { label: 'STABILIZING', color: 'var(--sev-green)' },
    resolved:    { label: 'RESOLVED',    color: 'var(--ink-2)' },
  };
  return map[lifecycle] || null;
}


/**
 * /region/:iso — tactical region brief.
 */
export default function RegionDetailPage() {
  const { iso } = useParams();
  if (!iso) return <RegionPicker />;
  return <RegionBrief iso={iso} />;
}

function RegionBrief({ iso }) {
  const { t } = useTranslation();

  const [openStory, setOpenStory] = useState(null);

  const liveNews = useNewsStore((s) => s.liveNews);
  const regionBackfills = useNewsStore((s) => s.regionBackfills);

  const {
    minSeverity, minConfidence, dateWindow, sortMode, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  } = useFilterStore();

  useEffect(() => {
    const store = useNewsStore.getState();
    if (!liveNews || liveNews.length === 0) {
      store.startAutoRefresh(() => {});
      return () => store.stopAutoRefresh();
    }
    return undefined;
  }, [liveNews]);

  useEffect(() => {
    if (!iso) return;
    const upper = iso.toUpperCase();
    useUIStore.getState().setLastRegionIso(upper);
    useNewsStore.getState().fetchRegionCoverage(upper);
    const regionName = isoToCountry(upper) || upper;
    useNewsStore.getState().fetchRegionBackfill(upper, regionName, { sortMode });
  }, [iso, sortMode]);

  const countryName = isoToCountry(iso?.toUpperCase()) || iso?.toUpperCase() || '?';
  const dateFloor = useMemo(() => resolveDateFloor(dateWindow), [dateWindow]);

  const filterParams = useMemo(() => ({
    minSeverity, minConfidence, dateFloor, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  }), [
    minSeverity, minConfidence, dateFloor, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  ]);

  const canonicalNews = useMemo(() => canonicalizeArticles(liveNews || []), [liveNews]);

  const regionNews = useMemo(() => {
    const upper = iso?.toUpperCase();
    const liveForRegion = canonicalNews.filter((s) => s.isoA2 === upper);
    const backfillEvents = regionBackfills?.[upper]?.events || [];
    const combined = liveForRegion.length > 0 ? liveForRegion : backfillEvents;
    return sortStories(combined.filter((s) => storyMatchesFilters(s, filterParams)), sortMode);
  }, [canonicalNews, regionBackfills, iso, filterParams, sortMode]);

  const avgSev = regionNews.length > 0
    ? (regionNews.reduce((s, a) => s + (a.severity || 0), 0) / regionNews.length / 10)
    : 0;
  const sevSub = sevTier(avgSev * 10);
  const sources = new Set(regionNews.map((a) => a.source).filter(Boolean));

  return (
    <div className="region-page">
      <div className="region-header">
        <div>
          <div className="region-crumb">
            <Link to="/" aria-label={t('nav.backToMap')}>/ MAP</Link>
            &nbsp;›&nbsp;REGION&nbsp;›&nbsp;<b style={{ color: 'var(--ink-0)' }}>{iso?.toUpperCase()}</b>
          </div>
          <div className="region-name">{countryName}</div>
          <div className="region-iso">ISO-3166 · {iso?.toUpperCase()}</div>
        </div>
        <div className="region-stats">
          <div className="stat">
            <span className="label">AVG SEVERITY</span>
            <span className={`val ${sevSub === 'red' || sevSub === 'black' ? 'sev-red' : sevSub === 'amber' ? 'sev-amber' : ''}`}>
              {avgSev.toFixed(2)}
            </span>
            <span className="sub">n={regionNews.length}</span>
          </div>
          <div className="stat">
            <span className="label">EVENTS</span>
            <span className="val">{regionNews.length}</span>
            <span className="sub">window: {dateWindow}</span>
          </div>
          <div className="stat">
            <span className="label">SOURCES</span>
            <span className="val">{sources.size}</span>
            <span className="sub">distinct</span>
          </div>
        </div>
      </div>

      <div className="region-articles">
        <div className="region-articles-head">
          <div className="micro">ARTICLES · FILTERED BY REGION</div>
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--ff-mono)', fontSize: 10, color: 'var(--ink-2)' }}>
            {regionNews.length}
          </span>
        </div>
        {regionNews.length === 0 && (
          regionBackfills?.[iso?.toUpperCase()]?.status === 'loading' ? (
            <div className="mini-panel-empty" style={{ padding: 24, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10 }}>
              <Loader size={14} className="admin-spinner" aria-hidden />
              {t('regionDetail.loading')}
            </div>
          ) : (
            <div className="mini-panel-empty" style={{ padding: 24 }}>
              NO ARTICLES IN WINDOW
            </div>
          )
        )}
        {regionNews.map((story) => {
          const tier = sevTier(story.severity);
          const sev = ((story.severity ?? 0) / 10).toFixed(1);
          const host = getSourceHost(story.url) || story.source || '';
          const conf = typeof story.confidence === 'number' ? story.confidence : null;
          const lMeta = lifecycleMeta(story.lifecycle);
          return (
            <div
              key={story.id}
              className="news-item"
              role="button"
              tabIndex={0}
              aria-label={story.title}
              onClick={() => setOpenStory(story)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setOpenStory(story); }
              }}
            >
              <div className="news-meta">
                <span className={`sev-pill sev-${tier}`}>{tier.toUpperCase()} · {sev}</span>
                {story.category && <span className="tag">{story.category}</span>}
                {lMeta && (
                  <span className="tag" style={{ color: lMeta.color, borderColor: lMeta.color }}>
                    {lMeta.label}
                  </span>
                )}
                <span style={{ marginLeft: 'auto' }}>{(story.language || 'EN').toUpperCase()}</span>
                <span>·</span>
                <span>{ago(story.firstSeenAt || story.publishedAt)}</span>
              </div>
              <div className="news-title">{story.title}</div>
              {story.summary && (
                <div className="news-summary-preview">{story.summary}</div>
              )}
              <div className="news-src">
                <span className="mono">{story.id}</span>
                {host && <> · {host}</>}
                {conf != null && <> · <span style={{ color: 'var(--ink-1)' }}>{conf}%</span></>}
                {story.url && (
                  <> · <a
                    href={story.url}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    style={{ color: 'var(--amber)', display: 'inline-flex', alignItems: 'center', gap: 3 }}
                  >
                    <ExternalLink size={10} aria-hidden /> OPEN
                  </a></>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="region-minimap">
        <div className="region-minimap-label">
          <div className="micro">MINI-MAP · {iso?.toUpperCase()}</div>
        </div>
        <Suspense fallback={<MapLoadingFallback />}>
          <FlatMap
            newsList={regionNews}
            regionSeverities={{}}
            mapOverlay="severity"
            coverageStatusByIso={{}}
            velocitySpikes={[]}
            trackingPoints={[]}
            selectedRegion={iso?.toUpperCase()}
            selectedStory={null}
            onRegionSelect={() => {}}
            onStorySelect={() => {}}
            onArcSelect={() => {}}
            compact
          />
        </Suspense>
        <div className="region-minimap-actions">
          <Link to="/" className="btn" aria-label={t('nav.backToMap')}>‹ BACK</Link>
        </div>
      </div>
      <ArticleSheet story={openStory} onClose={() => setOpenStory(null)} />
    </div>
  );
}

function RegionPicker() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');

  const liveNews = useNewsStore((s) => s.liveNews);
  const lastRegionIso = useUIStore((s) => s.lastRegionIso);

  useEffect(() => {
    if (!liveNews || liveNews.length === 0) {
      useNewsStore.getState().loadLiveData?.();
    }
  }, [liveNews]);

  const regions = useMemo(() => {
    const byIso = new Map();
    for (const story of liveNews || []) {
      const k = story.isoA2;
      if (!k) continue;
      const cur = byIso.get(k) || {
        iso: k, name: isoToCountry(k) || k, count: 0, maxSev: 0,
      };
      cur.count += 1;
      if ((story.severity ?? 0) > cur.maxSev) cur.maxSev = story.severity ?? 0;
      byIso.set(k, cur);
    }
    const list = [...byIso.values()];
    list.sort((a, b) => b.count - a.count || b.maxSev - a.maxSev);
    return list;
  }, [liveNews]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return regions;
    return regions.filter((r) =>
      r.iso.toLowerCase().includes(q) || r.name.toLowerCase().includes(q),
    );
  }, [regions, query]);

  const handlePick = (iso) => navigate(`/region/${iso}`);

  return (
    <div className="region-picker">
      <div className="region-picker-head">
        <div>
          <div className="region-crumb">
            <Link to="/" aria-label={t('nav.backToMap')}>/ MAP</Link>
            &nbsp;›&nbsp;REGION
          </div>
          <div className="region-name">Select a region</div>
          <div className="region-iso">
            {t(
              'nav.regionPickerHint',
              'Click a region on the map, or pick one from the list.',
            )}
          </div>
        </div>
      </div>

      <div className="region-picker-body">
        {lastRegionIso && (
          <button
            type="button"
            className="region-picker-recent"
            onClick={() => handlePick(lastRegionIso)}
          >
            <MapPin size={12} aria-hidden />
            <span className="region-picker-recent-label">LAST VIEWED</span>
            <span className="region-picker-recent-name">
              {isoToCountry(lastRegionIso) || lastRegionIso}
            </span>
            <span className="region-picker-recent-iso">{lastRegionIso}</span>
            <span className="region-picker-recent-arrow">→</span>
          </button>
        )}

        <div className="region-picker-search">
          <Search size={13} aria-hidden />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by country or ISO…"
            aria-label="Search regions"
          />
          <span className="region-picker-count">{filtered.length}</span>
        </div>

        {filtered.length === 0 && (
          <div className="region-picker-empty">NO REGIONS MATCH</div>
        )}
        <ul className="region-picker-list">
          {filtered.map((r) => (
            <li key={r.iso}>
              <button
                type="button"
                className="region-picker-row"
                onClick={() => handlePick(r.iso)}
              >
                <span className="region-picker-iso">{r.iso}</span>
                <span className="region-picker-name">{r.name}</span>
                <span className="region-picker-sev">
                  <span
                    className="region-picker-sev-dot"
                    style={{
                      background:
                        r.maxSev >= 85 ? 'var(--sev-black)' :
                        r.maxSev >= 70 ? 'var(--sev-red)' :
                        r.maxSev >= 40 ? 'var(--sev-amber)' : 'var(--sev-green)',
                    }}
                  />
                  {(r.maxSev / 10).toFixed(1)}
                </span>
                <span className="region-picker-count-sm">{r.count}</span>
                <span className="region-picker-arrow">→</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
