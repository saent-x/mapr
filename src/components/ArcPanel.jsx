import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, es, fr, ar, zhCN } from 'date-fns/locale';
import { X, Link2, MapPin, ExternalLink, ChevronDown } from 'lucide-react';
import { getSeverityMeta } from '../utils/mockData';
import { getSourceHost } from '../utils/urlUtils';
import { getConfidenceReasonLabel } from '../utils/confidenceReasons';
import { normalizeArticleText } from '../utils/articleText';
import { isoToCountry, KNOWN_COUNTRY_NAMES } from '../utils/geocoder';
import ExpandableText from './ExpandableText';

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

const DATE_LOCALES = { en: enUS, es, fr, ar, zh: zhCN };
const LANGUAGE_LABELS = { en: 'EN', es: 'ES', fr: 'FR', ar: 'AR', zh: 'ZH' };
const LOCATION_SIGNAL_KEYS = {
  'title-city': 'titleCity', 'title-country': 'titleCountry',
  'title-country-conflict': 'titleCountryConflict', 'summary-city': 'summaryCity',
  'summary-city-confirmed': 'summaryCityConfirmed', 'summary-country': 'summaryCountry',
  'summary-country-conflict': 'summaryCountryConflict', 'source-country': 'sourceCountry',
};

function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
function safeTimeAgo(value, opts) {
  const d = safeDate(value);
  return d ? formatDistanceToNow(d, opts) : '—';
}
function safeFormat(value, fmt, opts) {
  const d = safeDate(value);
  return d ? format(d, fmt, opts) : '—';
}

const ArcPanel = ({ arc, newsList, onStorySelect, onRegionSelect, onClose }) => {
  const { t, i18n } = useTranslation();
  const [expandedId, setExpandedId] = useState(null);
  const locale = DATE_LOCALES[i18n.language] || enUS;

  /** Render full story detail — same info as NewsPanel expanded view */
  const renderStoryDetail = (story) => {
    const sMeta = getSeverityMeta(story.severity);
    const normalizedTitle = normalizeArticleText(story.title);
    const normalizedSummary = normalizeArticleText(story.summary);
    const hasDistinctSummary = normalizedSummary && normalizedSummary !== normalizedTitle;
    const confidenceReasons = (story.confidenceReasons || [])
      .map((r) => ({ key: `${story.id}-${r.type}`, tone: r.tone || 'positive', label: getConfidenceReasonLabel(t, r) }))
      .filter((r) => r.label);
    const languages = (story.languages || [story.language]).filter((l) => l && l !== 'unknown').map((l) => LANGUAGE_LABELS[l] || l.toUpperCase());
    const sourceTypes = (story.sourceTypes || [story.sourceType]).filter(Boolean).map((st) => t(`sourceType.${st}`));
    const evidence = (story.supportingArticles || [])
      .filter((a, i, arr) => arr.findIndex((c) => (c.url || `${c.source}-${c.title}`) === (a.url || `${a.source}-${a.title}`)) === i)
      .slice(0, 3);
    const sourceLabel = getSourceHost(story.url, story.source || t('article.readFull'));

    return (
      <div className="news-card-expanded" onClick={(e) => e.stopPropagation()}>
        {story.socialimage && (
          <img className="news-card-image" src={story.socialimage} alt="" loading="lazy" onError={(e) => { e.target.style.display = 'none'; }} />
        )}
        {hasDistinctSummary && (
          <ExpandableText text={story.summary} collapsedLength={200} className="news-card-summary" textClassName="news-card-summary-copy" buttonClassName="news-card-summary-toggle" />
        )}
        <div className="news-card-detail-row">
          <span className="news-card-detail-label">{t('article.source')}</span>
          <span>{story.source || '—'}</span>
        </div>
        <div className="news-card-detail-row">
          <span className="news-card-detail-label">{t('article.published')}</span>
          <span>{safeFormat(story.publishedAt, 'PPp', { locale })}</span>
        </div>
        <div className="news-card-detail-row">
          <span className="news-card-detail-label">{t('article.category')}</span>
          <span>{story.category}</span>
        </div>
        <div className="news-card-detail-row">
          <span className="news-card-detail-label">{t('article.verification')}</span>
          <span>{t(`article.verificationStatus.${story.verificationStatus || 'single-source'}`)}</span>
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
              {confidenceReasons.map((r) => (
                <span key={r.key} className={`news-card-mini-badge ${r.tone === 'warning' ? 'is-warning' : 'is-positive'}`}>{r.label}</span>
              ))}
            </div>
          </div>
        )}
        <div className="news-card-detail-row">
          <span className="news-card-detail-label">{t('article.severity')}</span>
          <span style={{ color: sMeta.accent }}>{story.severity}</span>
        </div>
        {(sourceTypes.length > 0 || languages.length > 0) && (
          <div className="news-card-evidence-block">
            {sourceTypes.length > 0 && (
              <>
                <div className="news-card-detail-label">{t('article.sourceTypes')}</div>
                <div className="news-card-chip-row">{sourceTypes.map((st) => <span key={st} className="news-card-mini-badge">{st}</span>)}</div>
              </>
            )}
            {languages.length > 0 && (
              <>
                <div className="news-card-detail-label">{t('article.languages')}</div>
                <div className="news-card-chip-row">{languages.map((l) => <span key={l} className="news-card-mini-badge">{l}</span>)}</div>
              </>
            )}
          </div>
        )}
        {evidence.length > 0 && (
          <div className="news-card-evidence-block">
            <div className="news-card-detail-label">{t('article.evidence')}</div>
            <div className="news-card-source-list">
              {evidence.map((item) => item.url ? (
                <a key={item.url} className="news-card-source-item" href={item.url} target="_blank" rel="noopener noreferrer">
                  <span>{item.source || t('article.source')}</span>
                  <strong>{safeTimeAgo(item.publishedAt, { locale, addSuffix: true })}</strong>
                </a>
              ) : (
                <div key={`${item.source}-${item.title}`} className="news-card-source-item is-static">
                  <span>{item.source || t('article.source')}</span>
                </div>
              ))}
            </div>
          </div>
        )}
        {story.url && (
          <a className="news-card-read-more" href={story.url} target="_blank" rel="noopener noreferrer">
            <ExternalLink size={13} />
            {t('article.readFull')}
          </a>
        )}
      </div>
    );
  };

  const meta = getSeverityMeta(arc.severity);
  const startName = isoToCountry(arc.startIso) || arc.startRegion || arc.startIso;
  const endName = isoToCountry(arc.endIso) || arc.endRegion || arc.endIso;

  const ARC_TYPE_COLORS = {
    'same-event': '#ffffff',
    'shared-actor': '#00d4ff',
    'causal-flow': '#ffaa00',
  };
  const arcTypeColor = ARC_TYPE_COLORS[arc.type] || '#ffffff';
  const arcTypeLabel = arc.type === 'shared-actor' ? 'shared actor'
    : arc.type === 'causal-flow' ? 'causal flow'
    : 'same event';

  // Find events that connect both arc countries
  const { sharedEvents, startStories, endStories } = useMemo(() => {
    const startIso = arc.startIso;
    const endIso = arc.endIso;

    // Events whose countries array includes BOTH arc endpoints
    const shared = newsList
      .filter((s) => Array.isArray(s.countries) && s.countries.includes(startIso) && s.countries.includes(endIso))
      .sort((a, b) => (b.severity || 0) - (a.severity || 0));

    const sharedIds = new Set(shared.map((s) => s.id));

    // Remaining stories belonging to each individual country (not already in shared)
    const startItems = newsList
      .filter((s) => !sharedIds.has(s.id) && (s.isoA2 === startIso || (Array.isArray(s.countries) && s.countries.includes(startIso))))
      .sort((a, b) => (b.severity || 0) - (a.severity || 0));

    const endItems = newsList
      .filter((s) => !sharedIds.has(s.id) && (s.isoA2 === endIso || (Array.isArray(s.countries) && s.countries.includes(endIso))))
      .sort((a, b) => (b.severity || 0) - (a.severity || 0));

    return { sharedEvents: shared, startStories: startItems, endStories: endItems };
  }, [arc, newsList]);

  return (
    <div className="arc-panel is-open">
      {/* Header */}
      <div className="arc-panel-header">
        <div className="arc-panel-header-top">
          <Link2 size={12} style={{ color: arcTypeColor, flexShrink: 0 }} />
          <span className="arc-panel-category" style={{ color: arcTypeColor }}>
            {arcTypeLabel}
            {arc.label && (
              <span className="arc-panel-type-entity"> · {arc.label}</span>
            )}
          </span>
          <span className="arc-panel-severity" style={{ background: meta.muted, color: meta.accent }}>
            {meta.label}
          </span>
          <button className="arc-panel-close" onClick={onClose}>
            <X size={12} />
          </button>
        </div>
        <div className="arc-panel-countries">
          <button className="arc-panel-country" onClick={() => { onClose(); onRegionSelect(arc.startIso); }}>
            <MapPin size={10} />
            {startName}
          </button>
          <span className="arc-panel-link-icon">↔</span>
          <button className="arc-panel-country" onClick={() => { onClose(); onRegionSelect(arc.endIso); }}>
            <MapPin size={10} />
            {endName}
          </button>
        </div>
      </div>

      <div className="arc-panel-body">
        {/* Shared events — the actual connection between the two countries */}
        <div className="arc-panel-section">
          <div className="arc-panel-section-label">
            <Link2 size={9} />
            SHARED INTEL
            <span className="arc-panel-count">{sharedEvents.length}</span>
          </div>
          {sharedEvents.length > 0 ? sharedEvents.map((event) => {
            const sMeta = getSeverityMeta(event.severity);
            const isExpanded = expandedId === `shared-${event.id}`;
            const articleCount = event.articleCount || (event.supportingArticles || []).length || (event.articleIds || []).length;
            return (
              <div key={event.id} className={`arc-panel-shared ${isExpanded ? 'is-expanded' : ''}`}>
                <button
                  className="arc-panel-story"
                  onClick={() => setExpandedId(isExpanded ? null : `shared-${event.id}`)}
                >
                  <span className="arc-panel-story-dot" style={{ background: sMeta.accent }} />
                  <div className="arc-panel-story-text">
                    <span className="arc-panel-story-title">{event.title}</span>
                    <span className="arc-panel-story-meta">
                      {safeTimeAgo(event.publishedAt || event.lastUpdatedAt || event.firstSeenAt, { locale, addSuffix: true })}
                      {articleCount > 1 && <span className="event-source-count"> · {articleCount} sources</span>}
                    </span>
                    <span className="arc-panel-story-badges">
                      <LifecycleBadge lifecycle={event.lifecycle} />
                    </span>
                  </div>
                  <ChevronDown size={10} className={`arc-panel-chevron ${isExpanded ? 'is-open' : ''}`} />
                </button>
                {isExpanded && (
                  <div className="arc-panel-detail">
                    <div className="arc-panel-shared-countries">
                      <span className="arc-panel-shared-tag">{startName}</span>
                      <span className="arc-panel-shared-tag">{endName}</span>
                    </div>
                    {renderStoryDetail(event)}
                    {(event.supportingArticles || []).length > 1 && (
                      <div className="event-evidence">
                        <div className="event-evidence-header">{event.supportingArticles.length} sources reporting</div>
                        {event.supportingArticles.map((article, i) => (
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
          }) : (
            <div className="arc-panel-empty">No shared events found</div>
          )}
        </div>

        {/* Other stories in start country */}
        {startStories.length > 0 && (
          <div className="arc-panel-section">
            <div className="arc-panel-section-label">
              <MapPin size={9} />
              {startName}
              <span className="arc-panel-count">{startStories.length}</span>
            </div>
            {startStories.slice(0, 5).map((story) => {
              const sMeta = getSeverityMeta(story.severity);
              const isExpanded = expandedId === story.id;
              return (
                <div key={story.id} className={`arc-panel-story-wrap ${isExpanded ? 'is-expanded' : ''}`}>
                  <button className="arc-panel-story" onClick={() => setExpandedId(isExpanded ? null : story.id)}>
                    <span className="arc-panel-story-dot" style={{ background: sMeta.accent }} />
                    <div className="arc-panel-story-text">
                      <span className="arc-panel-story-title">{story.title}</span>
                      <span className="arc-panel-story-meta">{story.locality || story.region} · {sMeta.label}</span>
                      <span className="arc-panel-story-badges">
                        <LifecycleBadge lifecycle={story.lifecycle} />
                      </span>
                    </div>
                    <ChevronDown size={10} className={`arc-panel-chevron ${isExpanded ? 'is-open' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="arc-panel-detail">
                      {renderStoryDetail(story)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* Other stories in end country */}
        {endStories.length > 0 && (
          <div className="arc-panel-section">
            <div className="arc-panel-section-label">
              <MapPin size={9} />
              {endName}
              <span className="arc-panel-count">{endStories.length}</span>
            </div>
            {endStories.slice(0, 5).map((story) => {
              const sMeta = getSeverityMeta(story.severity);
              const isExpanded = expandedId === story.id;
              return (
                <div key={story.id} className={`arc-panel-story-wrap ${isExpanded ? 'is-expanded' : ''}`}>
                  <button className="arc-panel-story" onClick={() => setExpandedId(isExpanded ? null : story.id)}>
                    <span className="arc-panel-story-dot" style={{ background: sMeta.accent }} />
                    <div className="arc-panel-story-text">
                      <span className="arc-panel-story-title">{story.title}</span>
                      <span className="arc-panel-story-meta">{story.locality || story.region} · {sMeta.label}</span>
                      <span className="arc-panel-story-badges">
                        <LifecycleBadge lifecycle={story.lifecycle} />
                      </span>
                    </div>
                    <ChevronDown size={10} className={`arc-panel-chevron ${isExpanded ? 'is-open' : ''}`} />
                  </button>
                  {isExpanded && (
                    <div className="arc-panel-detail">
                      {renderStoryDetail(story)}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

export default ArcPanel;
