import React from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookmarkCheck, Trash2, Loader2, Crown, Pin, Copy, Clock3, Share2, Link as LinkIcon, X } from 'lucide-react';
import useSavedViews from '../hooks/useSavedViews';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import useNewsStore from '../stores/newsStore';
import useSubscription from '../hooks/useSubscription';

const DEFAULT_VIEW_ID = 'default';

const DEFAULT_VIEW_FILTERS = {
  searchQuery: '',
  minSeverity: 0,
  minConfidence: 0,
  dateWindow: '168h',
  sortMode: 'severity',
  verificationFilter: 'all',
  sourceTypeFilter: 'all',
  languageFilter: 'all',
  accuracyMode: 'standard',
  precisionFilter: 'all',
  hideAmplified: false,
  entityFilter: null,
};

const DEFAULT_VIEW_MAP_STATE = {
  mapMode: 'flat',
  mapOverlay: 'severity',
};

/**
 * Renders the saved views list in the sidebar.
 * Auth-gated: authenticated users see their views, unauthenticated see a login prompt.
 * Each view shows name + match count badge. Click applies the view. Trash deletes it.
 */
export default function SavedViewsSidebar() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const { views, isLoading, needsAuth, deleteView, updateView, duplicateView, generateShareToken, revokeShareToken } = useSavedViews(liveNews);
  const [shareModal, setShareModal] = React.useState(null); // { view, url } | null
  const [copied, setCopied] = React.useState(false);
  const { upgradeToPro, hasFeatureAccess } = useSubscription();
  const applyView = useFilterStore((s) => s.applyView);
  const setActiveViewId = useUIStore((s) => s.setActiveViewId);
  const activeViewId = useUIStore((s) => s.activeViewId);
  const visibleViews = React.useMemo(() => {
    const defaultView = {
      id: DEFAULT_VIEW_ID,
      name: t('savedViews.defaultName', 'Default view'),
      description: t('savedViews.defaultDescription', 'Live global severity, all sources, last 7 days.'),
      tags: [t('savedViews.defaultTag', 'baseline')],
      filters: DEFAULT_VIEW_FILTERS,
      mapState: DEFAULT_VIEW_MAP_STATE,
      matchCount: liveNews.length,
      isDefault: true,
      pinned: true,
      lastOpenedAt: null,
    };
    return [defaultView, ...views];
  }, [liveNews.length, t, views]);

  const handleSignIn = () => {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    navigate(`/login?returnUrl=${returnUrl}`);
  };

  const handleApply = async (view) => {
    applyView({ filters: view.filters, mapState: view.mapState });
    if (view.mapState?.mapMode) {
      useUIStore.getState().setMapMode(view.mapState.mapMode);
    }
    const params = new URLSearchParams(window.location.search);
    if (view.isDefault) {
      setActiveViewId(null);
      useUIStore.getState().closePanel();
      params.delete('view');
    } else {
      setActiveViewId(view.id);
      params.set('view', view.id);
      updateView(view.id, { lastOpenedAt: Date.now() }).catch(() => {});
    }
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  };

  const handleDelete = async (e, view) => {
    e.stopPropagation();
    if (view.isDefault) return;
    try {
      await deleteView(view.id);
      if (activeViewId === view.id) {
        setActiveViewId(null);
      }
    } catch (err) {
      // silently ignore — the InstantDB query will auto-remove from list
    }
  };

  const handlePin = async (e, view) => {
    e.stopPropagation();
    if (view.isDefault) return;
    try {
      await updateView(view.id, { pinned: !view.pinned });
    } catch {
      // InstantDB query will reflect any successful change
    }
  };

  const handleDuplicate = async (e, view) => {
    e.stopPropagation();
    try {
      await duplicateView(view, `${view.name} copy`);
    } catch {
      // silently ignore
    }
  };

  const buildShareUrl = (token) =>
    `${window.location.origin}/v/${encodeURIComponent(token)}`;

  const handleShare = async (e, view) => {
    e.stopPropagation();
    if (view.isDefault) return;
    if (!hasFeatureAccess('sharedViews')) {
      upgradeToPro().catch(() => {});
      return;
    }
    setCopied(false);
    try {
      let token = view.shareToken;
      if (!token) {
        token = await generateShareToken(view.id);
      }
      setShareModal({ view, url: buildShareUrl(token) });
    } catch (err) {
      console.warn('share generate failed', err.message);
    }
  };

  const handleRevoke = async () => {
    if (!shareModal) return;
    try {
      await revokeShareToken(shareModal.view.id);
      setShareModal(null);
    } catch (err) {
      console.warn('share revoke failed', err.message);
    }
  };

  const handleCopyShare = async () => {
    if (!shareModal) return;
    try {
      await navigator.clipboard.writeText(shareModal.url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch { /* clipboard not available */ }
  };

  if (needsAuth) {
    return (
      <div className="saved-views-sidebar sidebar-pro-feature-slot">
        <button
          type="button"
          className="sidebar-pro-feature-action"
          onClick={handleSignIn}
          title={t('savedViews.signInPrompt', 'Sign in to save views')}
          aria-label={t('savedViews.signInPrompt', 'Sign in to save views')}
        >
          <BookmarkCheck size={18} aria-hidden />
          <span className="sidebar-pro-feature-label">{t('savedViews.sidebarTitle', 'Saved views')}</span>
          <span className="sidebar-pro-badge" aria-label="Pro feature">
            <Crown size={7} aria-hidden />
          </span>
        </button>
      </div>
    );
  }

  if (!hasFeatureAccess('savedViews')) {
    return (
      <div className="saved-views-sidebar sidebar-pro-feature-slot">
        <button
          type="button"
          className="sidebar-pro-feature-action"
          onClick={() => upgradeToPro().catch(() => {})}
          title={t('subscription.featureLocked', { feature: t('subscription.features.savedViews', 'Saved Views') })}
          aria-label={t('subscription.featureLocked', { feature: t('subscription.features.savedViews', 'Saved Views') })}
        >
          <BookmarkCheck size={18} aria-hidden />
          <span className="sidebar-pro-feature-label">{t('savedViews.sidebarTitle', 'Saved views')}</span>
          <span className="sidebar-pro-badge" aria-label="Pro feature">
            <Crown size={7} aria-hidden />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="saved-views-sidebar">
      <div className="saved-views-header micro">
        <BookmarkCheck size={12} aria-hidden />
        <span>{t('savedViews.sidebarTitle', 'SAVED VIEWS')}</span>
        {visibleViews.length > 0 && (
          <span
            className="saved-views-count sidebar-section-count-badge"
            aria-label={t('savedViews.countAriaLabel', { count: visibleViews.length, defaultValue: `${visibleViews.length} saved views` })}
          >
            {visibleViews.length}
          </span>
        )}
      </div>

      {isLoading && (
        <div className="saved-views-loading">
          <Loader2 size={12} className="spin" />
        </div>
      )}

      {!isLoading && visibleViews.length === 0 && (
        <div className="saved-views-empty">
          {t('savedViews.emptyHint', 'Press s to save a view')}
        </div>
      )}

      {shareModal && (
        <div className="saved-views-share-modal" role="dialog" aria-modal="true" data-testid="share-view-modal">
          <div className="saved-views-share-modal-head">
            <span>{t('savedViews.shareLinkTitle', 'Share link for')} <b>{shareModal.view.name}</b></span>
            <button type="button" className="alert-rules-toggle" onClick={() => setShareModal(null)} aria-label={t('common.close', 'Close')}>
              <X size={10} aria-hidden />
            </button>
          </div>
          <p className="saved-views-share-modal-body">
            {t('savedViews.shareDescription', 'Anyone with this link can apply your view as read-only. Revoke any time.')}
          </p>
          <div className="saved-views-share-link-row">
            <LinkIcon size={10} aria-hidden />
            <input
              className="saved-views-share-input"
              readOnly
              value={shareModal.url}
              onFocus={(e) => e.target.select()}
              data-testid="share-view-link"
            />
            <button type="button" className="bookmarks-bulk-btn" onClick={handleCopyShare}>
              {copied ? t('common.copied', 'Copied') : t('common.copy', 'Copy')}
            </button>
          </div>
          <div className="saved-views-share-modal-actions">
            <button type="button" className="bookmarks-bulk-btn bookmarks-bulk-danger" onClick={handleRevoke} data-testid="share-view-revoke">
              {t('savedViews.shareRevoke', 'Revoke link')}
            </button>
          </div>
        </div>
      )}

      {!isLoading && visibleViews.length > 0 && (
        <ul className="saved-views-list" role="list">
          {visibleViews.map((view) => {
            const current = view.isDefault ? !activeViewId : activeViewId === view.id;
            return (
            <li key={view.id} className={`saved-views-item ${view.isDefault ? 'is-default-view' : ''}`}>
              <button
                type="button"
                className={`saved-views-btn ${current ? 'is-active' : ''}`}
                onClick={() => handleApply(view)}
                title={`${view.name} · ${view.matchCount} ${t('savedViews.matches', 'matches')}`}
                aria-label={t('savedViews.applyAriaLabel', { name: view.name, count: view.matchCount })}
              >
                <span className="saved-views-name-row">
                  <span className="saved-views-name">{view.name}</span>
                  {current && <span className="saved-views-current">{t('savedViews.current', 'Current')}</span>}
                  {view.pinned && <Pin size={9} className="saved-views-pin" aria-label={t('savedViews.pinned', 'Pinned')} />}
                </span>
                {view.description && <span className="saved-views-description">{view.description}</span>}
                {view.tags.length > 0 && (
                  <span className="saved-views-tags">
                    {view.tags.slice(0, 3).map((tag) => <span key={tag}>{tag}</span>)}
                  </span>
                )}
                <span className="saved-views-meta-row">
                  <span className="saved-views-count">{view.matchCount}</span>
                  <span className="saved-views-recency"><Clock3 size={8} aria-hidden />{view.lastOpenedAt ? t('savedViews.used', 'used') : t('savedViews.new', 'new')}</span>
                </span>
              </button>
              {!view.isDefault && (
                <>
                  <button
                    type="button"
                    className="saved-views-delete saved-views-pin-btn"
                    onClick={(e) => handlePin(e, view)}
                    title={view.pinned ? t('savedViews.unpin', 'Unpin view') : t('savedViews.pin', 'Pin view')}
                    aria-label={view.pinned ? t('savedViews.unpin', 'Unpin view') : t('savedViews.pin', 'Pin view')}
                  >
                    <Pin size={10} />
                  </button>
                  <button
                    type="button"
                    className="saved-views-delete saved-views-duplicate"
                    onClick={(e) => handleDuplicate(e, view)}
                    title={t('savedViews.duplicate', 'Duplicate view')}
                    aria-label={t('savedViews.duplicate', 'Duplicate view')}
                  >
                    <Copy size={10} />
                  </button>
                  <button
                    type="button"
                    className="saved-views-delete saved-views-share"
                    data-active={view.shareToken ? 'true' : undefined}
                    onClick={(e) => handleShare(e, view)}
                    title={view.shareToken ? t('savedViews.shareManage', 'Manage share link') : t('savedViews.share', 'Share view')}
                    aria-label={view.shareToken ? t('savedViews.shareManage', 'Manage share link') : t('savedViews.share', 'Share view')}
                    data-testid={`share-view-${view.id}`}
                  >
                    <Share2 size={10} />
                  </button>
                  <button
                    type="button"
                    className="saved-views-delete"
                    onClick={(e) => handleDelete(e, view)}
                    title={t('savedViews.deleteTitle', 'Delete view')}
                    aria-label={t('savedViews.deleteAriaLabel', { name: view.name })}
                  >
                    <Trash2 size={10} />
                  </button>
                </>
              )}
            </li>
          );
          })}
        </ul>
      )}
    </div>
  );
}
