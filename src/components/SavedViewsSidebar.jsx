import React from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkCheck, Trash2, Loader2, LogIn } from 'lucide-react';
import { SignedIn, SignedOut } from './auth';
import useSavedViews from '../hooks/useSavedViews';
import useFilterStore from '../stores/filterStore';
import useUIStore from '../stores/uiStore';
import useNewsStore from '../stores/newsStore';

/**
 * Renders the saved views list in the sidebar.
 * Auth-gated: authenticated users see their views, unauthenticated see a login prompt.
 * Each view shows name + match count badge. Click applies the view. Trash deletes it.
 */
export default function SavedViewsSidebar() {
  const { t } = useTranslation();
  const liveNews = useNewsStore((s) => s.liveNews) || [];
  const { views, isLoading, needsAuth, deleteView } = useSavedViews(liveNews);
  const applyView = useFilterStore((s) => s.applyView);
  const setActiveViewId = useUIStore((s) => s.setActiveViewId);
  const activeViewId = useUIStore((s) => s.activeViewId);

  const handleApply = (view) => {
    applyView({ filters: view.filters, mapState: view.mapState });
    setActiveViewId(view.id);
    // Update URL to include view=<id>
    const params = new URLSearchParams(window.location.search);
    params.set('view', view.id);
    const newUrl = `${window.location.pathname}?${params.toString()}`;
    window.history.replaceState(null, '', newUrl);
  };

  const handleDelete = async (e, view) => {
    e.stopPropagation();
    try {
      await deleteView(view.id);
      if (activeViewId === view.id) {
        setActiveViewId(null);
      }
    } catch (err) {
      // silently ignore — the InstantDB query will auto-remove from list
    }
  };

  return (
    <div className="saved-views-sidebar">
      <SignedIn>
        <div className="saved-views-header micro">
          <BookmarkCheck size={12} aria-hidden />
          <span>{t('savedViews.sidebarTitle', 'SAVED VIEWS')}</span>
        </div>

        {isLoading && (
          <div className="saved-views-loading">
            <Loader2 size={12} className="spin" />
          </div>
        )}

        {!isLoading && views.length === 0 && (
          <div className="saved-views-empty">
            {t('savedViews.emptyHint', 'Press s to save a view')}
          </div>
        )}

        {!isLoading && views.length > 0 && (
          <ul className="saved-views-list" role="list">
            {views.map((view) => (
              <li key={view.id} className="saved-views-item">
                <button
                  type="button"
                  className={`saved-views-btn ${activeViewId === view.id ? 'is-active' : ''}`}
                  onClick={() => handleApply(view)}
                  title={`${view.name} · ${view.matchCount} ${t('savedViews.matches', 'matches')}`}
                  aria-label={t('savedViews.applyAriaLabel', { name: view.name, count: view.matchCount })}
                >
                  <span className="saved-views-name">{view.name}</span>
                  <span className="saved-views-count">{view.matchCount}</span>
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
              </li>
            ))}
          </ul>
        )}
      </SignedIn>

      <SignedOut>
        {needsAuth && (
          <div className="saved-views-login-prompt">
            <LogIn size={10} aria-hidden />
            <span>{t('savedViews.signInPrompt', 'Sign in to save views')}</span>
          </div>
        )}
      </SignedOut>
    </div>
  );
}
