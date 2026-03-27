import React, { useEffect, useMemo } from 'react';
import { useParams, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, MapPin, BarChart3, Newspaper, ExternalLink } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import useFilterStore from '../stores/filterStore';
import { isoToCountry } from '../utils/geocoder';
import { sortStories, storyMatchesFilters } from '../utils/storyFilters';
import { canonicalizeArticles } from '../utils/newsPipeline';
import { getSeverityMeta, resolveDateFloor } from '../utils/mockData';

/**
 * Region detail view — shows a dedicated news panel for a specific country.
 * Accessible at /region/:iso (e.g. /region/US, /region/UA).
 */
export default function RegionDetailPage() {
  const { iso } = useParams();
  const { t } = useTranslation();

  const { liveNews, regionBackfills } = useNewsStore();
  const { minSeverity, minConfidence, dateWindow, sortMode, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified } = useFilterStore();
  const addToast = (msg, type) => { /* stub – page doesn't need toasts */ };

  /* Fetch data on mount */
  useEffect(() => {
    const store = useNewsStore.getState();
    if (!liveNews || liveNews.length === 0) {
      store.startAutoRefresh(addToast);
      return () => store.stopAutoRefresh();
    }
  }, [liveNews]);

  useEffect(() => {
    if (iso) {
      useNewsStore.getState().fetchRegionCoverage(iso);
      const regionName = isoToCountry(iso) || iso;
      useNewsStore.getState().fetchRegionBackfill(iso, regionName, { sortMode });
    }
  }, [iso, sortMode]);

  const countryName = isoToCountry(iso?.toUpperCase()) || iso?.toUpperCase() || '?';
  const dateFloor = useMemo(() => resolveDateFloor(dateWindow), [dateWindow]);

  const filterParams = useMemo(() => ({
    minSeverity, minConfidence, dateFloor, accuracyMode,
    verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified,
  }), [minSeverity, minConfidence, dateFloor, accuracyMode, verificationFilter, sourceTypeFilter, languageFilter, precisionFilter, hideAmplified]);

  const canonicalNews = useMemo(() => canonicalizeArticles(liveNews || []), [liveNews]);

  const regionNews = useMemo(() => {
    const upper = iso?.toUpperCase();
    const liveForRegion = canonicalNews.filter((s) => s.isoA2 === upper);
    const backfillEvents = regionBackfills[upper]?.events || [];
    const combined = liveForRegion.length > 0 ? liveForRegion : backfillEvents;
    return sortStories(combined.filter((s) => storyMatchesFilters(s, filterParams)), sortMode);
  }, [canonicalNews, regionBackfills, iso, filterParams, sortMode]);

  const backfillStatus = regionBackfills[iso?.toUpperCase()]?.status || 'idle';

  return (
    <div className="region-detail-page">
      <div className="region-detail-header">
        <Link to="/" className="region-detail-back" aria-label={t('nav.backToMap')}>
          <ArrowLeft size={18} />
        </Link>
        <div className="region-detail-title">
          <MapPin size={20} />
          <h1>{countryName}</h1>
          <span className="region-detail-iso">{iso?.toUpperCase()}</span>
        </div>
      </div>

      <div className="region-detail-stats">
        <div className="region-detail-stat">
          <Newspaper size={16} />
          <span className="region-detail-stat-value">{regionNews.length}</span>
          <span className="region-detail-stat-label">{t('regionDetail.articles')}</span>
        </div>
        <div className="region-detail-stat">
          <BarChart3 size={16} />
          <span className="region-detail-stat-value">
            {regionNews.length > 0 ? Math.round(regionNews.reduce((s, a) => s + (a.severity || 0), 0) / regionNews.length) : 0}
          </span>
          <span className="region-detail-stat-label">{t('regionDetail.avgSeverity')}</span>
        </div>
      </div>

      {backfillStatus === 'loading' && (
        <div className="region-detail-loading">{t('regionDetail.loading')}</div>
      )}

      <div className="region-detail-articles">
        {regionNews.length === 0 && backfillStatus !== 'loading' && (
          <div className="region-detail-empty">{t('regionDetail.noArticles')}</div>
        )}
        {regionNews.map((story) => {
          const meta = getSeverityMeta(story.severity);
          return (
            <article key={story.id} className="region-detail-card">
              <div className="region-detail-card-severity" style={{ borderLeftColor: meta.accent }}>
                <span className="region-detail-card-badge" style={{ background: meta.accent }}>
                  {meta.label}
                </span>
              </div>
              <h3 className="region-detail-card-title">{story.title}</h3>
              {story.summary && (
                <p className="region-detail-card-summary">{story.summary}</p>
              )}
              <div className="region-detail-card-meta">
                {story.source && <span className="region-detail-card-source">{story.source}</span>}
                {story.publishedAt && (
                  <time className="region-detail-card-time">
                    {new Date(story.publishedAt).toLocaleDateString()}
                  </time>
                )}
                {story.url && (
                  <a href={story.url} target="_blank" rel="noopener noreferrer" className="region-detail-card-link">
                    <ExternalLink size={12} /> {t('regionDetail.readMore')}
                  </a>
                )}
              </div>
            </article>
          );
        })}
      </div>
    </div>
  );
}
