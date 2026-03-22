import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink, ChevronUp } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, es, fr, ar, zhCN } from 'date-fns/locale';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { getSourceHost } from '../utils/urlUtils';
import { getConfidenceReasonLabel } from '../utils/confidenceReasons';
import { normalizeArticleText } from '../utils/articleText';
import ExpandableText from './ExpandableText';

const DATE_LOCALES = { en: enUS, es, fr, ar, zh: zhCN };

const LIFECYCLE_COLORS = {
  emerging: '#00d4ff',
  developing: '#00e5a0',
  escalating: '#ff5555',
  stabilizing: '#ffaa00',
  resolved: '#666'
};

function LifecycleBadge({ lifecycle }) {
  if (!lifecycle) return null;
  return (
    <span
      className="lifecycle-badge"
      style={{ color: LIFECYCLE_COLORS[lifecycle] || '#666', borderColor: LIFECYCLE_COLORS[lifecycle] || '#666' }}
    >
      {lifecycle}
    </span>
  );
}

/** Parse a date string safely — returns a valid Date or null. */
function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** formatDistanceToNow but returns '—' for invalid dates. */
function safeTimeAgo(value, opts) {
  const d = safeDate(value);
  return d ? formatDistanceToNow(d, opts) : '—';
}

/** format() but returns '—' for invalid dates. */
function safeFormat(value, fmt, opts) {
  const d = safeDate(value);
  return d ? format(d, fmt, opts) : '—';
}
const LANGUAGE_LABELS = {
  en: 'EN',
  es: 'ES',
  fr: 'FR',
  ar: 'AR',
  zh: 'ZH'
};
const COVERAGE_LABEL_KEYS = {
  verified: 'verified',
  developing: 'developing',
  'low-confidence': 'lowConfidence',
  'ingestion-risk': 'ingestionRisk',
  'source-sparse': 'sourceSparse',
  uncovered: 'uncovered'
};
const LOCATION_SIGNAL_KEYS = {
  'title-city': 'titleCity',
  'title-country': 'titleCountry',
  'title-country-conflict': 'titleCountryConflict',
  'summary-city': 'summaryCity',
  'summary-city-confirmed': 'summaryCityConfirmed',
  'summary-country': 'summaryCountry',
  'summary-country-conflict': 'summaryCountryConflict',
  'source-country': 'sourceCountry'
};

const NewsPanel = ({
  isOpen,
  regionName,
  regionStatus,
  regionData,
  coverageEntry,
  coverageTransitions = [],
  regionHistory,
  regionBackfillStatus = 'idle',
  regionSourcePlan = null,
  regionFeedChecks = [],
  news,
  selectedStoryId,
  onStorySelect,
  onClose
}) => {
  const { t, i18n } = useTranslation();
  const [expandedId, setExpandedId] = useState(null);
  const [checkpointsExpanded, setCheckpointsExpanded] = useState(false);
  const [mobileExpanded, setMobileExpanded] = useState(false);
  const expandedRef = useRef(null);
  const sheetRef = useRef(null);
  const dragStartY = useRef(null);

  // Reset mobile sheet state when panel closes or region changes
  useEffect(() => {
    setMobileExpanded(false);
  }, [regionName, isOpen]);

  // Touch drag handlers for the mobile bottom sheet handle
  const handleDragStart = useCallback((e) => {
    dragStartY.current = e.touches[0].clientY;
  }, []);

  const handleDragEnd = useCallback((e) => {
    if (dragStartY.current === null) return;
    const delta = dragStartY.current - e.changedTouches[0].clientY;
    dragStartY.current = null;
    // Swipe up → expand, swipe down → collapse or close
    if (delta > 40) {
      setMobileExpanded(true);
    } else if (delta < -40) {
      if (mobileExpanded) {
        setMobileExpanded(false);
      } else {
        onClose();
      }
    }
  }, [mobileExpanded, onClose]);

  const resolvedRegionName = regionName || regionData?.region || t('panel.closePanel');
  const sevMeta = getSeverityMeta(regionData?.averageSeverity || 0);
  const coverageMeta = getCoverageMeta(regionStatus || coverageEntry?.status || 'uncovered');
  const locale = DATE_LOCALES[i18n.language] || enUS;
  const getVerificationLabel = (status) => t(`article.verificationStatus.${status || 'single-source'}`);
  const regionTimeline = regionHistory?.snapshots || [];
  const transitionHistory = regionHistory?.transitions?.length ? regionHistory.transitions : coverageTransitions;
  const feedSummary = coverageEntry?.feedCount
    ? `${coverageEntry.healthyFeeds + coverageEntry.emptyFeeds}/${coverageEntry.feedCount}`
    : t('map.noLocalFeeds');
  const checkedFeedCount = regionFeedChecks.length;
  const checkedHealthyCount = regionFeedChecks.filter((feed) => feed.status === 'ok').length;
  const checkedFailedCount = regionFeedChecks.filter((feed) => feed.status === 'failed').length;

  useEffect(() => {
    if (expandedRef.current) {
      expandedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandedId]);

  // Auto-expand + scroll when a story is selected externally (e.g. search)
  useEffect(() => {
    if (selectedStoryId && news.some((story) => story.id === selectedStoryId)) {
      setExpandedId(selectedStoryId);
    }
  }, [selectedStoryId, news]);

  useEffect(() => {
    setExpandedId(null);
  }, [regionName]);

  useEffect(() => {
    if (!expandedId) {
      return;
    }

    if (!news.some((story) => story.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, news]);

  const handleCardClick = (story) => {
    onStorySelect(story);
    setExpandedId((prev) => (prev === story.id ? null : story.id));
  };

  const getSupportingEvidence = (story) => {
    const evidence = [];
    const seen = new Set();

    (story.supportingArticles || []).forEach((article) => {
      const key = article.url || `${article.source}-${article.title}`;
      if (!key || seen.has(key)) return;
      seen.add(key);
      evidence.push(article);
    });

    return evidence.slice(0, 5);
  };

  const getLanguageChips = (story) => (
    (story.languages || [story.language])
      .filter((language) => language && language !== 'unknown')
      .map((language) => LANGUAGE_LABELS[language] || language.toUpperCase())
  );

  const getSourceTypeChips = (story) => (
    (story.sourceTypes || [story.sourceType])
      .filter(Boolean)
      .map((type) => t(`sourceType.${type}`))
  );

  const getConfidenceChips = (story) => (
    (story.confidenceReasons || [])
      .map((reason) => ({
        key: `${story.id}-${reason.type}`,
        tone: reason.tone || 'positive',
        label: getConfidenceReasonLabel(t, reason)
      }))
      .filter((reason) => reason.label)
  );

  /** Render full story detail — same as ArcPanel */
  const renderStoryDetail = (story) => {
    const sMeta = getSeverityMeta(story.severity);
    const nTitle = normalizeArticleText(story.title);
    const nSummary = normalizeArticleText(story.summary);
    const hasSummary = nSummary && nSummary !== nTitle;
    const reasons = getConfidenceChips(story);
    const langs = getLanguageChips(story);
    const sTypes = getSourceTypeChips(story);
    const ev = getSupportingEvidence(story);

    return (
      <div className="news-card-expanded" onClick={(e) => e.stopPropagation()}>
        {story.socialimage && (
          <img className="news-card-image" src={story.socialimage} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
        )}
        {hasSummary && (
          <ExpandableText text={story.summary} collapsedLength={200} className="news-card-summary" textClassName="news-card-summary-copy" buttonClassName="news-card-summary-toggle" />
        )}
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.source')}</span><span>{story.source || '—'}</span></div>
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.published')}</span><span>{safeFormat(story.publishedAt, 'PPp', { locale })}</span></div>
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.category')}</span><span>{story.category}</span></div>
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.verification')}</span><span>{getVerificationLabel(story.verificationStatus)}</span></div>
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.locationPrecision')}</span><span>{t(`precision.${story.geocodePrecision || 'unknown'}`)}</span></div>
        {story.geocodeMatchedOn && (
          <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.locationSignal')}</span><span>{t(`article.locationSignalType.${LOCATION_SIGNAL_KEYS[story.geocodeMatchedOn] || 'sourceCountry'}`)}</span></div>
        )}
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.confidence')}</span><span>{story.confidence ?? 0}%</span></div>
        {reasons.length > 0 && (
          <div className="news-card-evidence-block">
            <div className="news-card-detail-label">{t('article.confidenceSignals')}</div>
            <div className="news-card-chip-row">{reasons.map((r) => <span key={r.key} className={`news-card-mini-badge ${r.tone === 'warning' ? 'is-warning' : 'is-positive'}`}>{r.label}</span>)}</div>
          </div>
        )}
        <div className="news-card-detail-row"><span className="news-card-detail-label">{t('article.severity')}</span><span style={{ color: sMeta.accent }}>{story.severity}</span></div>
        {(sTypes.length > 0 || langs.length > 0) && (
          <div className="news-card-evidence-block">
            {sTypes.length > 0 && (<><div className="news-card-detail-label">{t('article.sourceTypes')}</div><div className="news-card-chip-row">{sTypes.map((st) => <span key={st} className="news-card-mini-badge">{st}</span>)}</div></>)}
            {langs.length > 0 && (<><div className="news-card-detail-label">{t('article.languages')}</div><div className="news-card-chip-row">{langs.map((l) => <span key={l} className="news-card-mini-badge">{l}</span>)}</div></>)}
          </div>
        )}
        {ev.length > 0 && (
          <div className="news-card-evidence-block">
            <div className="news-card-detail-label">{t('article.evidence')}</div>
            <div className="news-card-source-list">
              {ev.map((item) => item.url ? (
                <a key={item.url} className="news-card-source-item" href={item.url} target="_blank" rel="noopener noreferrer"><span>{item.source || t('article.source')}</span><strong>{safeTimeAgo(item.publishedAt, { locale, addSuffix: true })}</strong></a>
              ) : (
                <div key={`${item.source}-${item.title}`} className="news-card-source-item is-static"><span>{item.source || t('article.source')}</span></div>
              ))}
            </div>
          </div>
        )}
        {story.url && (
          <a className="news-card-read-more" href={story.url} target="_blank" rel="noopener noreferrer"><ExternalLink size={13} />{t('article.readFull')}</a>
        )}
      </div>
    );
  };

  return (
    <div
      ref={sheetRef}
      className={`news-panel ${isOpen ? 'is-open' : ''} ${mobileExpanded ? 'is-mobile-expanded' : ''}`}
    >
      {/* Mobile drag handle */}
      <div
        className="news-panel-drag-handle"
        onTouchStart={handleDragStart}
        onTouchEnd={handleDragEnd}
        onClick={() => setMobileExpanded((prev) => !prev)}
      >
        <div className="news-panel-drag-bar" />
      </div>

      {/* Compact header — region name + badges + close */}
      <div className="news-panel-header">
        <div className="news-panel-title">
          <h2>{resolvedRegionName}</h2>
          <div className="news-panel-title-actions">
            {regionData && (
              <>
                <span className="meta-badge" style={{ background: sevMeta.muted, color: sevMeta.accent }}>
                  {t(`legend.${sevMeta.labelKey}`)}
                </span>
                <span className="meta-badge" style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}>
                  {regionData.count} {t('panel.reports')}
                </span>
              </>
            )}
            <button
              className="news-panel-expand-mobile"
              onClick={() => setMobileExpanded((prev) => !prev)}
              aria-label={mobileExpanded ? 'Collapse' : 'Expand'}
            >
              <ChevronUp size={14} className={mobileExpanded ? 'is-flipped' : ''} />
            </button>
            <button className="news-panel-close" onClick={onClose} aria-label={t('panel.closePanel')}>
              <X size={14} />
            </button>
          </div>
        </div>
      </div>

      {/* Collapsible diagnostics strip */}
      {coverageEntry && (
        <div className="news-panel-diag-strip">
          <span className="news-panel-diag-item" style={{ color: coverageMeta.accent }}>
            {t(`coverageStatus.${COVERAGE_LABEL_KEYS[coverageEntry.status] || 'uncovered'}`)}
          </span>
          <span className="news-panel-diag-item">
            {coverageEntry.maxConfidence ? `${coverageEntry.maxConfidence}%` : '—'}
          </span>
          <span className="news-panel-diag-item">
            {feedSummary}
          </span>
        </div>
      )}

      {/* Story list — arc-panel style */}
      <div className="news-panel-list">
        {news.length === 0 && regionBackfillStatus === 'loading' && (
          <div className="news-panel-skeleton">
            <div className="skeleton skeleton-header" />
            {[1, 2, 3].map((i) => <div key={i} className="skeleton skeleton-card" />)}
          </div>
        )}
        {news.length === 0 && regionBackfillStatus !== 'loading' && (
          <div className="news-panel-empty">
            <strong>{t('panel.noRegionNews')}</strong>
            <span>{t('panel.noRegionNewsHint')}</span>
          </div>
        )}
        {news.map((story) => {
          const meta = getSeverityMeta(story.severity);
          const isExpanded = expandedId === story.id;

          return (
            <div
              key={story.id}
              ref={isExpanded ? expandedRef : null}
              className={`arc-panel-story-wrap ${isExpanded ? 'is-expanded' : ''} ${selectedStoryId === story.id ? 'is-selected' : ''}`}
            >
              <button
                className="arc-panel-story"
                onClick={() => handleCardClick(story)}
              >
                <span className="arc-panel-story-dot" style={{ background: meta.accent }} />
                <div className="arc-panel-story-text">
                  <span className="arc-panel-story-title">{story.title}</span>
                  <span className="arc-panel-story-meta">
                    {story.locality || story.region} · {safeTimeAgo(story.publishedAt, { locale, addSuffix: true })}
                    {story.articleCount > 1 && (
                      <span className="event-source-count"> · {story.articleCount} sources</span>
                    )}
                  </span>
                  <span className="arc-panel-story-badges">
                    <LifecycleBadge lifecycle={story.lifecycle} />
                    {story.amplification?.isAmplified && (
                      <span className="amplification-badge" title={story.amplification.reason}>
                        ⚠ amplified
                      </span>
                    )}
                  </span>
                  {story.entities && (
                    <div className="entity-tags">
                      {(story.entities.organizations || []).slice(0, 3).map(org => (
                        <span key={org.name} className="entity-tag entity-tag-org">{org.name}</span>
                      ))}
                      {(story.entities.people || []).slice(0, 2).map(p => (
                        <span key={p.name} className="entity-tag entity-tag-person">{p.name}</span>
                      ))}
                    </div>
                  )}
                </div>
                <ChevronUp size={10} className={`arc-panel-chevron ${isExpanded ? 'is-open' : ''}`} style={{ transform: isExpanded ? 'rotate(180deg)' : 'rotate(0deg)' }} />
              </button>
              {isExpanded && (
                <div className="arc-panel-detail">
                  {renderStoryDetail(story)}
                  {story.supportingArticles?.length > 1 && (
                    <div className="event-evidence">
                      <div className="event-evidence-header">{story.supportingArticles.length} sources reporting</div>
                      {story.supportingArticles.map((article, i) => (
                        <div key={article.id || i} className="event-evidence-item">
                          <span className="event-evidence-source">{article.source}</span>
                          <a href={article.url} target="_blank" rel="noopener noreferrer" className="event-evidence-title">
                            {article.title}
                          </a>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NewsPanel;
