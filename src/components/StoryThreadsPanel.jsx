import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router-dom';
import useSubscriptionStore from '../stores/subscriptionStore';
import { listThreads, archiveThread } from '../services/backendService.js';

function formatRelative(iso, t) {
  if (!iso) return '—';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return '—';
  const diff = Date.now() - ts;
  const m = Math.round(diff / 60000);
  if (m < 1) return t('time.justNow', 'just now');
  if (m < 60) return t('time.minutesAgo', { count: m, defaultValue: '{{count}}m ago' });
  const h = Math.round(m / 60);
  if (h < 24) return t('time.hoursAgo', { count: h, defaultValue: '{{count}}h ago' });
  const d = Math.round(h / 24);
  return t('time.daysAgo', { count: d, defaultValue: '{{count}}d ago' });
}

export default function StoryThreadsPanel({ prefilterEntity = '' } = {}) {
  const { t } = useTranslation();
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  const [threads, setThreads] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!isAuthenticated) {
      setThreads([]);
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    listThreads()
      .then((data) => { if (!cancelled) setThreads(data?.threads || []); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load threads'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [isAuthenticated]);

  const filtered = useMemo(() => {
    if (!prefilterEntity) return threads;
    const q = prefilterEntity.toLowerCase();
    return threads.filter((t) => (t.title || '').toLowerCase().includes(q));
  }, [threads, prefilterEntity]);

  const handleArchive = async (threadId) => {
    setThreads((prev) => prev.filter((t) => t.id !== threadId));
    try { await archiveThread(threadId); }
    catch (err) {
      setError(err.message || 'Failed to archive');
    }
  };

  return (
    <div className="threads-panel" data-testid="threads-panel">
      <header className="threads-panel-head">
        <div>
          <h2 className="threads-panel-title">{t('threads.title')}</h2>
          <p className="threads-panel-sub">{t('threads.subtitle')}</p>
        </div>
        {threads.length > 0 && (
          <span className="mono threads-panel-count">
            {t('threads.threadCount', { count: threads.length })}
          </span>
        )}
      </header>

      {!isAuthenticated && (
        <div className="threads-empty" data-testid="threads-signin">
          <div className="mono threads-empty-title">{t('auth.required', 'SIGN IN REQUIRED')}</div>
          <p className="threads-empty-body">{t('auth.signInForThreads', 'Sign in to pin events and track stories over time.')}</p>
          <Link to="/account" className="btn primary">{t('auth.signIn', 'Sign in')}</Link>
        </div>
      )}

      {isAuthenticated && loading && (
        <div className="threads-empty"><div className="mono threads-empty-title">{t('loading.page')}</div></div>
      )}

      {isAuthenticated && !loading && error && (
        <div className="threads-empty" role="alert" data-testid="threads-error">
          <div className="mono threads-empty-title">ERROR</div>
          <p className="threads-empty-body">{error}</p>
        </div>
      )}

      {isAuthenticated && !loading && !error && filtered.length === 0 && (
        <div className="threads-empty" data-testid="threads-empty">
          <div className="mono threads-empty-title">{t('threads.emptyTitle')}</div>
          <p className="threads-empty-body">
            {prefilterEntity
              ? t('threads.emptyPrefilter', { entity: prefilterEntity })
              : t('threads.emptyBody')}
          </p>
          <p className="threads-empty-note">{t('threads.comingSoon')}</p>
        </div>
      )}

      {isAuthenticated && !loading && filtered.length > 0 && (
        <ul className="threads-list" data-testid="threads-list">
          {filtered.map((thread) => (
            <li key={thread.id} className="threads-card" data-testid={`thread-${thread.id}`}>
              <div className="threads-card-head">
                <h3 className="threads-card-title">{thread.title}</h3>
                <span className="mono threads-card-meta">
                  {t('threads.articleCount', { count: thread.articleCount })}
                  {' · '}
                  {t('threads.lastUpdate')}: {formatRelative(thread.lastActivityAt, t)}
                </span>
              </div>
              <div className="threads-card-actions">
                {thread.seedEventId && (
                  <Link className="btn" to={`/event/${encodeURIComponent(thread.seedEventId)}`}>
                    {t('threads.viewThread')}
                  </Link>
                )}
                <button type="button" className="btn" onClick={() => handleArchive(thread.id)}>
                  {t('threads.unpin')}
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
