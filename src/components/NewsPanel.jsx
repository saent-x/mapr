import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ExternalLink, ChevronDown, ChevronUp, Maximize2 } from 'lucide-react';
import useProgressiveList from '../hooks/useProgressiveList.js';
import useUIStore from '../stores/uiStore.js';
import useBreakpoint from '../hooks/useBreakpoint.js';
import BottomSheet from './ui/BottomSheet';
import { getSourceHost } from '../utils/urlUtils';

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

function formatTs(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function verificationMeta(status) {
  switch (status) {
    case 'verified':
      return { label: 'VERIFIED', color: 'var(--sev-green)' };
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

function NewsThumb({ story }) {
  const [failed, setFailed] = useState(false);
  const src = story.socialimage || story.image || null;
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

export function ArticleSheet({ story, onClose }) {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  useEffect(() => {
    if (!story) return undefined;
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [story, onClose]);
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
  const supporting = Array.isArray(story.supportingArticles)
    ? story.supportingArticles.filter((a) => a && a.url && a.url !== story.url).slice(0, 6)
    : [];
  const orgs = story.entities?.organizations?.slice(0, 6) || [];
  const people = story.entities?.people?.slice(0, 6) || [];
  const confidence = typeof story.confidence === 'number' ? story.confidence : null;
  const reasons = Array.isArray(story.confidenceReasons) ? story.confidenceReasons : [];

  const body = (
    <>
      <div className="article-sheet-head">
          <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)' }} />
          EVENT · <span className="mono" style={{ color: 'var(--ink-0)' }}>{story.id}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <span style={{ color: 'var(--ink-2)' }}>{ago(story.firstSeenAt || story.publishedAt)}</span>
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')} style={{ marginLeft: 12, color: 'var(--ink-2)' }}>×</button>
        </div>
        <div className="article-sheet-body">
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
          <p className="news-card-summary">{story.summary || '—'}</p>

          <dl className="news-card-detail-grid">
            <div className="news-card-detail-row">
              <dt>SOURCE</dt>
              <dd>{story.source || host || '—'}</dd>
            </div>
            <div className="news-card-detail-row">
              <dt>PUBLISHED</dt>
              <dd>{formatTs(story.publishedAt)}</dd>
            </div>
            {story.firstSeenAt && (
              <div className="news-card-detail-row">
                <dt>FIRST SEEN</dt>
                <dd>{formatTs(story.firstSeenAt)}</dd>
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
                <dt>CONFIDENCE</dt>
                <dd>{confidence}%</dd>
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
                SUPPORTING ({supporting.length})
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
        </div>
    </>
  );

  if (isMobile) {
    return (
      <BottomSheet
        open={!!story}
        onClose={onClose}
        title={story.title?.slice(0, 40) || 'Article'}
        ariaLabel={story.title}
        maxHeightVh={100}
      >
        <div className="article-sheet-mobile">{body}</div>
      </BottomSheet>
    );
  }

  return (
    <>
      <div className="article-sheet-backdrop" onClick={onClose} aria-hidden />
      <aside className="article-sheet" role="dialog" aria-label={story.title} aria-modal="true">
        {body}
      </aside>
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
  onStorySelect,
  onClose,
  variant,
}) => {
  const { t } = useTranslation();
  const { isMobile } = useBreakpoint();
  const [openStory, setOpenStory] = useState(null);
  const items = (news && news.length > 0) ? news : allEvents;

  const collapsed = useUIStore((s) => s.panelCollapsed.liveFeed);
  const togglePanelCollapsed = useUIStore((s) => s.togglePanelCollapsed);

  const { visibleItems: visibleNews, hasMore, sentinelRef } = useProgressiveList(items, {
    initialCount: 30,
    batchSize: 20,
    resetKey: regionName || 'all',
  });

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
        const host = getSourceHost(story.url) || story.source || '';
        const conf = typeof story.confidence === 'number' ? story.confidence : null;
        const lMeta = lifecycleMeta(story.lifecycle);
        return (
          <div
            key={story.id}
            className="news-item"
            data-active={active || undefined}
            role="button"
            tabIndex={0}
            aria-label={story.title}
            onClick={() => { onStorySelect?.(story); setOpenStory(story); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onStorySelect?.(story); setOpenStory(story); }
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
              {story.isoA2 && <> · {story.isoA2}</>}
              {conf != null && <> · <span style={{ color: 'var(--ink-1)' }}>{conf}%</span></>}
            </div>
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
      <>
        <div className="news-panel news-panel-inline" role="region" aria-label="Live news feed">
          <div className="panel-header">
            <span className="dot" />
            <span>FEED · LIVE</span>
            <span className="spacer" />
            <span style={{ color: 'var(--ink-2)' }}>{items.length} items</span>
          </div>
          <div className="panel-body">{listBody}</div>
        </div>
        <ArticleSheet story={openStory} onClose={() => setOpenStory(null)} />
      </>
    );
  }

  if (isMobile) {
    if (!isOpen) return null;
    return (
      <>
        <BottomSheet
          open={isOpen}
          onClose={onClose}
          title={regionName || 'News'}
          peekVh={50}
          maxHeightVh={90}
        >
          <div className="news-panel-mobile-body">
            {listBody}
          </div>
        </BottomSheet>
        <ArticleSheet story={openStory} onClose={() => setOpenStory(null)} />
      </>
    );
  }

  return (
    <>
      <div
        className="floating-panel news-panel"
        data-collapsed={collapsed || undefined}
        role="region"
        aria-label="Live news feed"
      >
        <div className="panel-header">
          <span className="dot" />
          <span>FEED · LIVE</span>
          <span className="spacer" />
          <span style={{ color: 'var(--ink-2)' }}>{items.length} items</span>
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
      <ArticleSheet story={openStory} onClose={() => setOpenStory(null)} />
    </>
  );
};

export default NewsPanel;
