import React, { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { ExternalLink, ChevronDown, ChevronUp, Maximize2, FileText } from 'lucide-react';
import useProgressiveList from '../hooks/useProgressiveList.js';
import useUIStore from '../stores/uiStore';
import useBreakpoint from '../hooks/useBreakpoint.js';
import BottomSheet from './ui/BottomSheet';
import BookmarkButton from './BookmarkButton';
import { getSourceHost } from '../utils/urlUtils';
import { getReliabilityTier, getReliabilityMeta, getReliabilityLabel } from '../utils/credibilityMeta';
import { getArticleTextPreview, normalizeArticleText } from '../utils/articleText';
import { formatConfidencePercent, normalizeConfidenceScore } from '../utils/confidenceScore';

function ago(ts) {
  if (!ts) return '—';
  const dt = typeof ts === 'string' ? new Date(ts).getTime() : ts;
  if (Number.isNaN(dt)) return '—';
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

function formatTs(ts, locale) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  // Locale-aware short timestamp. Falls back to the user's runtime locale
  // when the i18n locale isn't passed.
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  }
}

function feedSourceLabel(dataSource) {
  if (dataSource === 'loading') return 'LOADING';
  if (dataSource === 'live') return 'LIVE';
  return 'OFFLINE';
}

function verificationMeta(status) {
  switch (status) {
    case 'corroborated':
      return { label: 'CORROBORATED', color: 'var(--sev-green)' };
    // Backwards-compat for any legacy snapshot; same meaning, new label.
    case 'verified':
      return { label: 'CORROBORATED', color: 'var(--sev-green)' };
    case 'official':
      return { label: 'OFFICIAL', color: 'var(--cyan)' };
    case 'corroborated':
      return { label: 'CORROBORATED', color: 'var(--sev-green)' };
    case 'single-source':
      return { label: 'SINGLE SOURCE', color: 'var(--sev-amber)' };
    case 'amplified':
      return { label: 'AMPLIFIED', color: 'var(--sev-amber)' };
    default:
      return null;
  }
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

function safeImageSrc(value) {
  if (!value) return null;
  const raw = String(value).trim();
  const srcMatch = raw.match(/\bsrc\s*=\s*["']([^"']+)["']/i);
  const candidate = (srcMatch?.[1] || raw).trim();
  try {
    const url = new URL(candidate);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function NewsThumb({ story }) {
  const [failed, setFailed] = useState(false);
  const src = safeImageSrc(story.socialimage || story.image);
  if (!src || failed) return null;
  return (
    <img
      className="news-card-image"
      src={src}
      alt=""
      loading="lazy"
      onError={() => setFailed(true)}
    />
  );
}

export function ArticleDetail({ story }) {
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  if (!story) return null;
  const tier = sevTier(story.severity);
  const sev = ((story.severity ?? 0) / 10).toFixed(1);
  const host = getSourceHost(story.url) || story.source || '';
  const vMeta = verificationMeta(story.verificationStatus);
  const lMeta = lifecycleMeta(story.lifecycle);
  const langs = Array.isArray(story.languages)
    ? story.languages
    : (story.language ? [story.language] : []);
  const srcTypes = Array.isArray(story.sourceTypes) ? story.sourceTypes : [];
  // Keep the full list so the count is honest (label says "SUPPORTING (N)"
  // where N is the real total) and only slice when rendering the visible cards.
  const supportingAll = Array.isArray(story.supportingArticles)
    ? story.supportingArticles.filter((a) => a && a.url && a.url !== story.url)
    : [];
  const supporting = supportingAll.slice(0, 6);
  const supportingTotal = supportingAll.length;
  const orgs = story.entities?.organizations?.slice(0, 6) || [];
  const people = story.entities?.people?.slice(0, 6) || [];
  const confidence = normalizeConfidenceScore(story.confidence);
  const reasons = Array.isArray(story.confidenceReasons) ? story.confidenceReasons : [];

  return (
    <>
      <NewsThumb story={story} />
      <div className="news-card-pill-row">
        <span className={`sev-pill sev-${tier}`}>{tier.toUpperCase()} · SEV {sev}</span>
        {vMeta && (
          <span className="news-card-mini-badge" style={{ color: vMeta.color, borderColor: vMeta.color }}>
            {vMeta.label}
          </span>
        )}
        {lMeta && (
          <span className="news-card-mini-badge" style={{ color: lMeta.color, borderColor: lMeta.color }}>
            {lMeta.label}
          </span>
        )}
        {story.category && (
          <span className="tag mono news-card-mini-badge">{String(story.category).toUpperCase()}</span>
        )}
        {story.isoA2 && <span className="mono" style={{ color: 'var(--ink-2)' }}>{story.isoA2}</span>}
        {Array.isArray(story.coordinates) && story.coordinates.length >= 2 && (
          <span className="mono" style={{ color: 'var(--ink-2)', marginLeft: 'auto' }}>
            {Number(story.coordinates[1]).toFixed(2)}, {Number(story.coordinates[0]).toFixed(2)}
          </span>
        )}
      </div>
      <h2>{story.title}</h2>
      <p className="news-card-summary">{normalizeArticleText(story.summary) || '—'}</p>

      <dl className="news-card-detail-grid">
        <div className="news-card-detail-row">
          <dt>SOURCE</dt>
          <dd>{story.source || host || '—'}</dd>
        </div>
        <div className="news-card-detail-row">
          <dt>PUBLISHED</dt>
          <dd>{formatTs(story.publishedAt, locale)}</dd>
        </div>
        {story.firstSeenAt && (
          <div className="news-card-detail-row">
            <dt>FIRST SEEN</dt>
            <dd>{formatTs(story.firstSeenAt, locale)}</dd>
          </div>
        )}
        {story.category && (
          <div className="news-card-detail-row">
            <dt>CATEGORY</dt>
            <dd>{String(story.category).toUpperCase()}</dd>
          </div>
        )}
        {story.region && (
          <div className="news-card-detail-row">
            <dt>REGION</dt>
            <dd>{story.region}{story.locality ? ` · ${story.locality}` : ''}</dd>
          </div>
        )}
        {confidence != null && (
          <div className="news-card-detail-row">
            <dt>{t('eventDetail.confidence', 'Event Confidence')}</dt>
            <dd>{formatConfidencePercent(story.confidence)}</dd>
          </div>
        )}
        {story.sourceCredibility != null && (
          <div className="news-card-detail-row">
            <dt>{t('eventDetail.sourceReliability', 'Source Corroboration')}</dt>
            <dd>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
              }}>
                <span style={{
                  display: 'inline-block',
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: getReliabilityMeta(getReliabilityTier(story.sourceCredibility)).dotColor,
                }} />
                <span>{getReliabilityLabel(story.sourceCredibility)}</span>
                <span style={{ color: 'var(--ink-2)' }}>
                  ({Math.round(story.sourceCredibility * 100)}%)
                </span>
              </span>
            </dd>
          </div>
        )}
        {typeof story.sourceCount === 'number' && (
          <div className="news-card-detail-row">
            <dt>SOURCES</dt>
            <dd>
              {story.sourceCount}
              {typeof story.independentSourceCount === 'number'
                ? ` · ${story.independentSourceCount} independent`
                : ''}
            </dd>
          </div>
        )}
        {story.geocodePrecision && (
          <div className="news-card-detail-row">
            <dt>PRECISION</dt>
            <dd>{String(story.geocodePrecision).toUpperCase()}</dd>
          </div>
        )}
      </dl>

      {(srcTypes.length > 0 || langs.length > 0) && (
        <div className="news-card-chip-row">
          {srcTypes.map((s) => (
            <span key={`st-${s}`} className="news-card-mini-badge">{String(s).toUpperCase()}</span>
          ))}
          {langs.map((l) => (
            <span key={`lg-${l}`} className="news-card-mini-badge">{String(l).toUpperCase()}</span>
          ))}
        </div>
      )}

      {reasons.length > 0 && (
        <div className="news-card-chip-row">
          {reasons.map((r, i) => (
            <span
              key={`r-${i}`}
              className={`news-card-mini-badge tone-${r.tone || 'neutral'}`}
            >
              {(r.label || r.type || '').toString().replace(/-/g, ' ').toUpperCase()}
            </span>
          ))}
        </div>
      )}

      {(orgs.length > 0 || people.length > 0) && (
        <div className="news-card-entities">
          <div className="micro" style={{ marginBottom: 6 }}>ENTITIES</div>
          <div className="news-card-chip-row">
            {orgs.map((o, i) => (
              <span key={`o-${i}`} className="news-card-mini-badge">{(o.name || o).toString().toUpperCase()}</span>
            ))}
            {people.map((p, i) => (
              <span key={`p-${i}`} className="news-card-mini-badge">{(p.name || p).toString().toUpperCase()}</span>
            ))}
          </div>
        </div>
      )}

      <div className="news-card-source-block">
        <div className="micro" style={{ marginBottom: 10 }}>SOURCE</div>
        <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 11, color: 'var(--ink-1)' }}>
          {host || '—'}
          {story.url && (
            <>
              {' · '}
              <a
                className="news-card-read-more"
                href={story.url}
                target="_blank"
                rel="noreferrer"
                style={{ color: 'var(--amber)' }}
              >
                <ExternalLink size={11} aria-hidden /> OPEN ARTICLE
              </a>
            </>
          )}
        </div>
      </div>

      {supporting.length > 0 && (
        <div className="news-card-source-block">
          <div className="micro" style={{ marginBottom: 10 }}>
            SUPPORTING ({supportingTotal}){supportingTotal > supporting.length ? ` · SHOWING ${supporting.length}` : ''}
          </div>
          <ul className="news-card-source-list">
            {supporting.map((a, i) => (
              <li key={`sa-${i}`}>
                <a
                  className="news-card-source-item"
                  href={a.url}
                  target="_blank"
                  rel="noreferrer"
                >
                  {a.source || getSourceHost(a.url) || a.url}
                </a>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="news-card-source-block">
        <Link
          to={`/event/${encodeURIComponent(story.id)}`}
          state={{ event: story }}
          className="btn primary sm"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 6, textDecoration: 'none' }}
        >
          <Maximize2 size={11} aria-hidden />
          {t('eventDetail.viewDetail', 'View event detail')}
        </Link>
      </div>
    </>
  );
}

/**
 * NewsPanel — floating feed panel (top-right on the `/` surface).
 * Uses useProgressiveList for batched rendering of large article lists.
 */
const NewsPanel = ({
  isOpen,
  regionIso,
  regionName,
  regionData,
  news = [],
  allEvents = [],
  selectedStoryId,
  kbHighlightedStoryId,
  onStorySelect,
  onClose,
  variant,
  dataSource = 'live',
}) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isMobile } = useBreakpoint();
  const [expandedId, setExpandedId] = useState(null);
  const collapsedSelectedStoryRef = useRef(null);
  const items = (news && news.length > 0) ? news : allEvents;

  const collapsed = useUIStore((s) => s.panelCollapsed.liveFeed);
  const togglePanelCollapsed = useUIStore((s) => s.togglePanelCollapsed);
  const sourceLabel = feedSourceLabel(dataSource);
  const regionLabel = regionName || 'News';
  const ariaLabel = sourceLabel === 'LIVE'
    ? 'Live news feed'
    : `${sourceLabel.toLowerCase()} news feed`;

  const { visibleItems: visibleNews, hasMore, sentinelRef } = useProgressiveList(items, {
    initialCount: 30,
    batchSize: 20,
    resetKey: regionName || 'all',
  });

  useEffect(() => {
    if (!selectedStoryId) return;
    if (collapsedSelectedStoryRef.current === selectedStoryId) return;
    if (items.some((story) => story.id === selectedStoryId)) {
      setExpandedId(selectedStoryId);
    }
  }, [items, selectedStoryId]);

  useEffect(() => {
    if (!expandedId) return;
    if (!items.some((story) => story.id === expandedId)) {
      setExpandedId(null);
    }
  }, [expandedId, items]);

  const listBody = (
    <>
      {regionIso && (
        <Link
          to={`/region/${String(regionIso).toUpperCase()}`}
          className="feed-region-link"
          aria-label={`Open region page for ${regionName || regionIso}`}
        >
          <Maximize2 size={11} aria-hidden />
          <span className="feed-region-link-label">VIEW REGION PAGE</span>
          <span className="feed-region-link-iso">{String(regionIso).toUpperCase()}</span>
          <span className="feed-region-link-arrow">→</span>
        </Link>
      )}
      {items.length === 0 && (
        <div className="news-panel-empty">NO ITEMS</div>
      )}
      {visibleNews.map((story) => {
        const tier = sevTier(story.severity);
        const sev = ((story.severity ?? 0) / 10).toFixed(1);
        const active = selectedStoryId === story.id;
        const expanded = expandedId === story.id;
        const kbHighlighted = kbHighlightedStoryId === story.id;
        const host = getSourceHost(story.url) || story.source || '';
        const conf = normalizeConfidenceScore(story.confidence);
        const lMeta = lifecycleMeta(story.lifecycle);
        const toggle = () => {
          if (expanded) {
            collapsedSelectedStoryRef.current = story.id;
            setExpandedId(null);
            return;
          }
          collapsedSelectedStoryRef.current = null;
          onStorySelect?.(story);
          setExpandedId(story.id);
        };
        return (
          <div
            key={story.id}
            className="news-item"
            data-active={active || undefined}
            data-expanded={expanded || undefined}
            data-kb-highlighted={kbHighlighted ? 'true' : undefined}
            role="button"
            tabIndex={0}
            aria-label={story.title}
            aria-expanded={expanded}
            aria-controls={`detail-${story.id}`}
            onClick={toggle}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
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
              {story.sourceCredibility != null && (
                <span
                  className="news-reliability-dot"
                  style={{
                    background: getReliabilityMeta(getReliabilityTier(story.sourceCredibility)).dotColor,
                  }}
                  title={`Source corroboration: ${getReliabilityLabel(story.sourceCredibility)} (${Math.round(story.sourceCredibility * 100)}%)`}
                  aria-label={`Source corroboration: ${Math.round(story.sourceCredibility * 100)}%`}
                />
              )}
              <BookmarkButton story={story} className="news-bookmark-btn" />
              <button
                type="button"
                className="news-detail-link-btn"
                title={t('eventDetail.viewDetail', 'View event detail')}
                aria-label={t('eventDetail.viewDetail', 'View event detail')}
                onClick={(e) => {
                  e.stopPropagation();
                  navigate(`/event/${encodeURIComponent(story.id)}`, { state: { event: story } });
                }}
              >
                <Maximize2 size={12} aria-hidden />
              </button>
              <span style={{ marginLeft: 'auto' }}>{(story.language || 'EN').toUpperCase()}</span>
              <span>·</span>
              <span>{ago(story.firstSeenAt || story.publishedAt)}</span>
            </div>
            <div className="news-title">{story.title}</div>
            {story.summary && (
              <div className="news-summary-preview">{getArticleTextPreview(story.summary, 180).text}</div>
            )}
            <div className="news-src">
              <span className="mono">{story.id}</span>
              {host && <> · {host}</>}
              {story.isoA2 && <> · {story.isoA2}</>}
              {conf != null && <> · <span style={{ color: 'var(--ink-1)' }}>{formatConfidencePercent(story.confidence)}</span></>}
            </div>
            {expanded && (
              <div
                id={`detail-${story.id}`}
                className="news-item-detail"
                onClick={(e) => e.stopPropagation()}
              >
                <ArticleDetail story={story} />
              </div>
            )}
          </div>
        );
      })}
      <div ref={sentinelRef} className="news-panel-load-more-sentinel" aria-hidden />
      {hasMore && (
        <div className="news-panel-load-more">
          {t('panel.loadingMore', { shown: visibleNews.length, total: items.length })}
        </div>
      )}
    </>
  );

  if (variant === 'inline') {
    return (
      <div className="news-panel news-panel-inline" role="region" aria-label={ariaLabel}>
        <div className="panel-header">
          <span className="dot" />
          <span className="news-panel-title">FEED · {sourceLabel}</span>
          <span className="spacer" />
          <span className="news-panel-count tnum">{items.length} items</span>
        </div>
        <div className="panel-body">{listBody}</div>
      </div>
    );
  }

  if (isMobile) {
    if (!isOpen) return null;
    return (
      <BottomSheet
        open={isOpen}
        onClose={onClose}
        title={regionLabel}
        peekVh={50}
        maxHeightVh={90}
      >
        <div className="news-panel-mobile-body">
          {listBody}
        </div>
      </BottomSheet>
    );
  }

  return (
    <div
      className="floating-panel news-panel"
      data-collapsed={collapsed || undefined}
      role="region"
      aria-label={ariaLabel}
    >
      <div className="panel-header">
        <span className="dot" />
        <span className="news-panel-title">FEED · {sourceLabel}</span>
        <span className="spacer" />
        <span className="news-panel-count tnum">{items.length} items</span>
        <button
          type="button"
          className="news-panel-briefing-btn"
          onClick={() => useUIStore.getState().setShowExport(true)}
          aria-label={t('export.generateBriefing', 'Generate Briefing')}
          title={t('export.generateBriefing', 'Generate Briefing')}
        >
          <FileText size={12} aria-hidden />
        </button>
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => togglePanelCollapsed('liveFeed')}
          aria-label={collapsed ? 'Expand feed' : 'Collapse feed'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
        </button>
        {isOpen && regionName && (
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}>×</button>
        )}
      </div>
      <div className="panel-body" aria-hidden={collapsed || undefined}>
        {listBody}
      </div>
    </div>
  );
};

export default NewsPanel;
