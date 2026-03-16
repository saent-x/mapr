import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, es, fr, ar, zhCN } from 'date-fns/locale';
import { getSeverityMeta } from '../utils/mockData';
import { getCoverageMeta } from '../utils/coverageMeta';
import { getSourceHost } from '../utils/urlUtils';
import { getConfidenceReasonLabel } from '../utils/confidenceReasons';
import { normalizeArticleText } from '../utils/articleText';
import ExpandableText from './ExpandableText';

const DATE_LOCALES = { en: enUS, es, fr, ar, zh: zhCN };
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
  const expandedRef = useRef(null);

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

  return (
    <div className={`news-panel ${isOpen ? 'is-open' : ''}`}>
      <div className="news-panel-header">
        <div className="news-panel-title">
          <h2>{resolvedRegionName}</h2>
          <button className="news-panel-close" onClick={onClose} aria-label={t('panel.closePanel')}>
            <X size={16} />
          </button>
        </div>

        {regionData ? (
          <div className="news-panel-meta">
            <span
              className="meta-badge"
              style={{ background: sevMeta.muted, color: sevMeta.accent }}
            >
              {t(`legend.${sevMeta.labelKey}`)}
            </span>
            <span
              className="meta-badge"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
            >
              {regionData.count} {regionData.count === 1 ? t('panel.report') : t('panel.reports')}
            </span>
            <span
              className="meta-badge"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
            >
              {t('panel.avg')} {Math.round(regionData.averageSeverity)}
            </span>
          </div>
        ) : regionStatus ? (
          <div className="news-panel-meta">
            <span
              className="meta-badge"
              style={{ background: coverageMeta.fill, color: coverageMeta.accent }}
            >
              {t(`coverageStatus.${COVERAGE_LABEL_KEYS[regionStatus] || 'uncovered'}`)}
            </span>
          </div>
        ) : null}
      </div>

      <div className="news-panel-list">
        {coverageEntry && (
          <div className="news-panel-diagnostics">
            <div className="news-panel-diagnostics-grid">
              <div className="news-panel-diagnostic-card">
                <span>{t('map.status')}</span>
                <strong style={{ color: coverageMeta.accent }}>
                  {t(`coverageStatus.${COVERAGE_LABEL_KEYS[coverageEntry.status] || 'uncovered'}`)}
                </strong>
              </div>
              <div className="news-panel-diagnostic-card">
                <span>{t('map.confidence')}</span>
                <strong>{coverageEntry.maxConfidence ? `${coverageEntry.maxConfidence}%` : '—'}</strong>
              </div>
              <div className="news-panel-diagnostic-card">
                <span>{t('map.reports')}</span>
                <strong>{coverageEntry.eventCount}</strong>
              </div>
              <div className="news-panel-diagnostic-card">
                <span>{t('map.sourceFeeds')}</span>
                <strong>{feedSummary}</strong>
              </div>
            </div>

            <div className="news-panel-transition-block">
              <div className="news-card-detail-label">{t('panel.recentTransitions')}</div>
              {transitionHistory.length > 0 ? (
                <div className="news-panel-transition-list">
                  {transitionHistory.map((entry) => (
                    <div
                      key={`${entry.at}-${entry.toStatus}-${entry.fromStatus}`}
                      className={`news-panel-transition-item ${entry.direction === 'down' ? 'is-risk' : 'is-positive'}`}
                    >
                      <span className="news-panel-transition-time">
                        {formatDistanceToNow(new Date(entry.at), { locale, addSuffix: true })}
                      </span>
                      <strong>
                        {t(`coverageStatus.${COVERAGE_LABEL_KEYS[entry.fromStatus] || 'uncovered'}`)}
                        {' -> '}
                        {t(`coverageStatus.${COVERAGE_LABEL_KEYS[entry.toStatus] || 'uncovered'}`)}
                      </strong>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="news-card-empty">{t('panel.noRecentTransitions')}</div>
              )}
            </div>

            <div className="news-panel-transition-block">
              <div className="news-card-detail-label">{t('panel.recentCheckpoints')}</div>
              {regionTimeline.length > 0 ? (
                <>
                  <div className="news-panel-checkpoint-list">
                    {(checkpointsExpanded ? regionTimeline : regionTimeline.slice(0, 3)).map((entry) => {
                      const checkpointMeta = getCoverageMeta(entry.status || 'uncovered');
                      return (
                        <div key={`${entry.at}-${entry.status}`} className="news-panel-checkpoint-item">
                          <div className="news-panel-checkpoint-head">
                            <strong>{formatDistanceToNow(new Date(entry.at), { locale, addSuffix: true })}</strong>
                            <span
                              className="news-panel-checkpoint-status"
                              style={{ background: checkpointMeta.fill, color: checkpointMeta.accent }}
                            >
                              {t(`coverageStatus.${COVERAGE_LABEL_KEYS[entry.status] || 'uncovered'}`)}
                            </span>
                          </div>
                          <div className="news-panel-checkpoint-meta">
                            <span>{entry.maxConfidence ? `${entry.maxConfidence}% ${t('map.confidence')}` : t('map.confidence')}</span>
                            <span>{entry.eventCount} {t('map.reports')}</span>
                            <span>
                              {entry.feedCount ? `${entry.feedCount} ${t('map.sourceFeeds')}` : t('map.noLocalFeeds')}
                            </span>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                  {regionTimeline.length > 3 && (
                    <button
                      className="news-panel-checkpoint-toggle"
                      onClick={() => setCheckpointsExpanded((prev) => !prev)}
                    >
                      {checkpointsExpanded ? t('panel.showLess') : t('panel.showAll', { count: regionTimeline.length })}
                    </button>
                  )}
                </>
              ) : (
                <div className="news-card-empty">{t('panel.noRecentCheckpoints')}</div>
              )}
            </div>

            {regionSourcePlan && (
              <div className="news-panel-transition-block">
                <div className="news-card-detail-label">{t('panel.sourcePlan')}</div>
                <div className="news-panel-diagnostics-grid">
                  <div className="news-panel-diagnostic-card">
                    <span>{t('panel.localFeeds')}</span>
                    <strong>{regionSourcePlan.localFeedCount}</strong>
                  </div>
                  <div className="news-panel-diagnostic-card">
                    <span>{t('panel.regionalFeeds')}</span>
                    <strong>{regionSourcePlan.regionalFeedCount || 0}</strong>
                  </div>
                  <div className="news-panel-diagnostic-card">
                    <span>{t('panel.plannedFeeds')}</span>
                    <strong>{regionSourcePlan.plannedFeedCount}</strong>
                  </div>
                  <div className="news-panel-diagnostic-card">
                    <span>{t('panel.checkedFeeds')}</span>
                    <strong>{checkedFeedCount}</strong>
                  </div>
                  <div className="news-panel-diagnostic-card">
                    <span>{t('panel.failedChecks')}</span>
                    <strong>{checkedFailedCount}</strong>
                  </div>
                </div>

                {regionSourcePlan.localFeedCount === 0 && (
                  <div className="news-panel-source-hint">
                    <strong>{t('panel.noLocalFeedCatalog')}</strong>
                    <span>{t('panel.noLocalFeedCatalogHint')}</span>
                  </div>
                )}

                {regionSourcePlan.plannedFeeds?.length > 0 && (
                  <div className="news-panel-feed-chip-list">
                    {regionSourcePlan.plannedFeeds.slice(0, 8).map((feed) => (
                      <span key={feed.id} className="news-panel-feed-chip">
                        {feed.name}
                      </span>
                    ))}
                  </div>
                )}

                {checkedFeedCount > 0 ? (
                  <div className="news-panel-feed-check-list">
                    {regionFeedChecks.slice(0, 6).map((feed) => (
                      <div key={`${feed.feedId}-${feed.status}`} className="news-panel-feed-check-item">
                        <div className="news-panel-feed-check-head">
                          <strong>{feed.name}</strong>
                          <span className={`news-panel-feed-check-status is-${feed.status}`}>
                            {t(`healthStatus.${feed.status}`)}
                          </span>
                        </div>
                        <span>
                          {feed.status === 'ok'
                            ? `${feed.articleCount || 0} ${t('header.stories')}`
                            : (feed.error || t('panel.feedCheckFailed'))}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="news-card-empty">{t('panel.noFeedChecks')}</div>
                )}
              </div>
            )}
          </div>
        )}

        {news.length === 0 && regionBackfillStatus === 'loading' && (
          <div className="news-panel-empty">
            <strong>{t('panel.searchingRegionNews')}</strong>
            <span>{t('panel.searchingRegionNewsHint')}</span>
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
          const verificationLabel = getVerificationLabel(story.verificationStatus);
          const evidence = getSupportingEvidence(story);
          const languages = getLanguageChips(story);
          const sourceTypes = getSourceTypeChips(story);
          const confidenceReasons = getConfidenceChips(story);
          const sourceLabel = getSourceHost(story.url, story.source || t('article.readFull'));
          const normalizedTitle = normalizeArticleText(story.title);
          const normalizedSummary = normalizeArticleText(story.summary);
          const hasDistinctSummary = normalizedSummary && normalizedSummary !== normalizedTitle;

          return (
            <div
              key={story.id}
              ref={isExpanded ? expandedRef : null}
              className={`news-card ${selectedStoryId === story.id ? 'is-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(story)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(story); }}
            >
              <div className="news-card-top">
                <span
                  className="news-card-severity"
                  style={{ background: meta.muted, color: meta.accent }}
                >
                  {t(`legend.${meta.labelKey}`)}
                </span>
                <span className="news-card-time">
                  {formatDistanceToNow(new Date(story.publishedAt), { locale, addSuffix: true })}
                </span>
              </div>
              <h3>{story.title}</h3>
              {hasDistinctSummary && (
                <ExpandableText
                  text={story.summary}
                  collapsedLength={220}
                  className="news-card-summary"
                  textClassName="news-card-summary-copy"
                  buttonClassName="news-card-summary-toggle"
                />
              )}
              <div className="news-card-footer">
                <span>{story.locality || story.region}</span>
                <span>{story.category}</span>
                <span>{verificationLabel}</span>
              </div>
              {story.url && (
                <div className="news-card-inline-actions">
                  <a
                    className="news-card-inline-link"
                    href={story.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <ExternalLink size={12} />
                    {sourceLabel}
                  </a>
                </div>
              )}

              {isExpanded && (
                <div className="news-card-expanded" onClick={(e) => e.stopPropagation()}>
                  {story.socialimage && (
                    <img
                      className="news-card-image"
                      src={story.socialimage}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.source')}</span>
                    <span>{story.source || '—'}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.published')}</span>
                    <span>{format(new Date(story.publishedAt), 'PPp', { locale })}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.category')}</span>
                    <span>{story.category}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.verification')}</span>
                    <span>{verificationLabel}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.locationPrecision')}</span>
                    <span>{t(`precision.${story.geocodePrecision || 'unknown'}`)}</span>
                  </div>
                  {story.geocodeMatchedOn && (
                    <div className="news-card-detail-row">
                      <span className="news-card-detail-label">{t('article.locationSignal')}</span>
                      <span>{t(`article.locationSignalType.${LOCATION_SIGNAL_KEYS[story.geocodeMatchedOn] || 'sourceCountry'}`)}</span>
                    </div>
                  )}
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.confidence')}</span>
                    <span>{story.confidence ?? 0}%</span>
                  </div>
                  {confidenceReasons.length > 0 && (
                    <div className="news-card-evidence-block">
                      <div className="news-card-detail-label">{t('article.confidenceSignals')}</div>
                      <div className="news-card-chip-row">
                        {confidenceReasons.map((reason) => (
                          <span
                            key={reason.key}
                            className={`news-card-mini-badge ${reason.tone === 'warning' ? 'is-warning' : 'is-positive'}`}
                          >
                            {reason.label}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.sources')}</span>
                    <span>{story.sourceCount ?? 1}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.independentSources')}</span>
                    <span>{story.independentSourceCount ?? story.sourceCount ?? 1}</span>
                  </div>
                  {story.firstSeenAt && (
                    <div className="news-card-detail-row">
                      <span className="news-card-detail-label">{t('article.firstSeen')}</span>
                      <span>{format(new Date(story.firstSeenAt), 'PPp', { locale })}</span>
                    </div>
                  )}
                  {story.lastSeenAt && (
                    <div className="news-card-detail-row">
                      <span className="news-card-detail-label">{t('article.lastSeen')}</span>
                      <span>{format(new Date(story.lastSeenAt), 'PPp', { locale })}</span>
                    </div>
                  )}
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.severity')}</span>
                    <span style={{ color: meta.accent }}>{story.severity}</span>
                  </div>
                  {(sourceTypes.length > 0 || languages.length > 0) && (
                    <div className="news-card-evidence-block">
                      {sourceTypes.length > 0 && (
                        <>
                          <div className="news-card-detail-label">{t('article.sourceTypes')}</div>
                          <div className="news-card-chip-row">
                            {sourceTypes.map((type) => (
                              <span key={type} className="news-card-mini-badge">{type}</span>
                            ))}
                          </div>
                        </>
                      )}
                      {languages.length > 0 && (
                        <>
                          <div className="news-card-detail-label">{t('article.languages')}</div>
                          <div className="news-card-chip-row">
                            {languages.map((language) => (
                              <span key={language} className="news-card-mini-badge">{language}</span>
                            ))}
                          </div>
                        </>
                      )}
                    </div>
                  )}
                  <div className="news-card-evidence-block">
                    <div className="news-card-detail-label">{t('article.evidence')}</div>
                    {evidence.length > 0 ? (
                      <div className="news-card-source-list">
                        {evidence.map((item) => (
                          item.url ? (
                            <a
                              key={item.url || `${item.source}-${item.title}`}
                              className="news-card-source-item"
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                            >
                              <span>{item.source || t('article.source')}</span>
                              <strong>{formatDistanceToNow(new Date(item.publishedAt), { locale, addSuffix: true })}</strong>
                            </a>
                          ) : (
                            <div key={`${item.source}-${item.title}`} className="news-card-source-item is-static">
                              <span>{item.source || t('article.source')}</span>
                              <strong>{formatDistanceToNow(new Date(item.publishedAt), { locale, addSuffix: true })}</strong>
                            </div>
                          )
                        ))}
                      </div>
                    ) : (
                      <div className="news-card-empty">{t('article.noEvidence')}</div>
                    )}
                  </div>
                  {story.url && (
                    <a
                      className="news-card-read-more"
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={13} />
                      {t('article.readFull')}
                    </a>
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
