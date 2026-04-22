import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import useProgressiveList from '../hooks/useProgressiveList.js';
import { getSeverityMeta } from '../utils/mockData';
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

function ArticleSheet({ story, onClose }) {
  const { t } = useTranslation();
  if (!story) return null;
  const tier = sevTier(story.severity);
  const sev = ((story.severity ?? 0) / 10).toFixed(1);
  const host = getSourceHost(story.url) || story.source || '';
  return (
    <>
      <div className="article-sheet-backdrop" onClick={onClose} aria-hidden />
      <aside className="article-sheet" role="dialog" aria-label={story.title} aria-modal="true">
        <div className="article-sheet-head">
          <span className="dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--amber)' }} />
          EVENT · <span className="mono" style={{ color: 'var(--ink-0)' }}>{story.id}</span>
          <span className="spacer" style={{ flex: 1 }} />
          <span style={{ color: 'var(--ink-2)' }}>{ago(story.firstSeenAt || story.publishedAt)}</span>
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')} style={{ marginLeft: 12, color: 'var(--ink-2)' }}>×</button>
        </div>
        <div className="article-sheet-body">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
            <span className={`sev-pill sev-${tier}`}>{tier.toUpperCase()} · SEV {sev}</span>
            {story.category && <span className="tag mono" style={{ color: 'var(--ink-2)', border: '1px solid var(--line-2)', padding: '1px 6px', textTransform: 'uppercase' }}>{story.category}</span>}
            {story.isoA2 && <span className="mono" style={{ color: 'var(--ink-2)' }}>{story.isoA2}</span>}
            {story.coordinates && (
              <span className="mono" style={{ color: 'var(--ink-2)', marginLeft: 'auto' }}>
                {Number(story.coordinates.lng || 0).toFixed(2)}, {Number(story.coordinates.lat || 0).toFixed(2)}
              </span>
            )}
          </div>
          <h2>{story.title}</h2>
          <p>{story.summary || '—'}</p>
          <div style={{ borderTop: '1px solid var(--line)', paddingTop: 16 }}>
            <div className="micro" style={{ marginBottom: 10 }}>SOURCE</div>
            <div style={{ fontFamily: 'var(--ff-mono)', fontSize: 11, color: 'var(--ink-1)' }}>
              {host}
              {story.url && (
                <> · <a href={story.url} target="_blank" rel="noreferrer" style={{ color: 'var(--amber)' }}>OPEN</a></>
              )}
            </div>
          </div>
        </div>
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
  regionName,
  regionData,
  news = [],
  allEvents = [],
  selectedStoryId,
  onStorySelect,
  onClose,
}) => {
  const { t } = useTranslation();
  const [openStory, setOpenStory] = useState(null);
  const items = (news && news.length > 0) ? news : allEvents;

  const { visibleItems: visibleNews, hasMore, sentinelRef } = useProgressiveList(items, {
    initialCount: 30,
    batchSize: 20,
    resetKey: regionName || 'all',
  });

  return (
    <>
      <div className="floating-panel news-panel" role="region" aria-label="Live news feed">
        <div className="panel-header">
          <span className="dot" />
          <span>FEED · LIVE</span>
          <span className="spacer" />
          <span style={{ color: 'var(--ink-2)' }}>{items.length} items</span>
          {isOpen && regionName && (
            <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}>×</button>
          )}
        </div>
        <div className="panel-body">
          {items.length === 0 && (
            <div className="news-panel-empty">NO ITEMS</div>
          )}
          {visibleNews.map((story) => {
            const tier = sevTier(story.severity);
            const sev = ((story.severity ?? 0) / 10).toFixed(1);
            const active = selectedStoryId === story.id;
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
                  <span style={{ marginLeft: 'auto' }}>{(story.language || 'EN').toUpperCase()}</span>
                  <span>·</span>
                  <span>{ago(story.firstSeenAt || story.publishedAt)}</span>
                </div>
                <div className="news-title">{story.title}</div>
                <div className="news-src">
                  <span className="mono">{story.id}</span>
                  {story.source && <> · {story.source}</>}
                  {story.isoA2 && <> · {story.isoA2}</>}
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
        </div>
      </div>
      <ArticleSheet story={openStory} onClose={() => setOpenStory(null)} />
    </>
  );
};

export default NewsPanel;
