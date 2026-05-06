import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookmarkCheck, LogIn, Filter, X, ChevronDown, ChevronUp } from 'lucide-react';
import { SignedIn, SignedOut } from './auth';
import useBookmarks from '../hooks/useBookmarks';
import useUIStore from '../stores/uiStore';

const SEVERITY_OPTIONS = [
  { value: 0, label: 'All' },
  { value: 20, label: '≥ Watch (20)' },
  { value: 40, label: '≥ Elevated (40)' },
  { value: 70, label: '≥ Critical (70)' },
  { value: 85, label: '≥ Black (85)' },
];

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

/**
 * BookmarksPanel — displayed in the sidebar.
 * Lists bookmarked stories with filter controls for region, severity, and date.
 * Auth-gated: authenticated users see their bookmarks, unauthenticated see a login prompt.
 */
export default function BookmarksPanel() {
  const { t } = useTranslation();
  const {
    bookmarks,
    filteredBookmarks,
    isLoading,
    needsAuth,
    filterRegion,
    setFilterRegion,
    filterMinSeverity,
    setFilterMinSeverity,
    filterDateFrom,
    setFilterDateFrom,
    filterDateTo,
    setFilterDateTo,
    toggleBookmark,
  } = useBookmarks();

  const [collapsed, setCollapsed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const selectStory = useUIStore((s) => s.selectStory);

  const uniqueRegions = React.useMemo(() => {
    const regions = new Set();
    for (const b of bookmarks) {
      if (b.region) regions.add(b.region);
    }
    return [...regions].sort();
  }, [bookmarks]);

  const handleRemove = async (e, bookmark) => {
    e.stopPropagation();
    e.preventDefault();
    try {
      await toggleBookmark({ id: bookmark.storyId, title: bookmark.storyTitle });
    } catch {
      // silently ignore
    }
  };

  const handleSelect = (bookmark) => {
    selectStory({ id: bookmark.storyId, title: bookmark.storyTitle, isoA2: bookmark.region, severity: bookmark.severity });
  };

  return (
    <div className="bookmarks-sidebar">
      <SignedIn>
        <div className="saved-views-header micro">
          <BookmarkCheck size={12} aria-hidden />
          <span>{t('bookmarks.sidebarTitle', 'BOOKMARKS')}</span>
          <span className="saved-views-count" style={{ marginLeft: 'auto' }}>{filteredBookmarks.length}</span>
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={() => setShowFilters((v) => !v)}
            aria-label={showFilters ? 'Hide filters' : 'Show filters'}
            title="Filters"
            data-active={showFilters ? 'true' : undefined}
          >
            <Filter size={10} aria-hidden />
          </button>
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={() => setCollapsed((v) => !v)}
            aria-label={collapsed ? 'Expand bookmarks' : 'Collapse bookmarks'}
            title={collapsed ? 'Expand' : 'Collapse'}
          >
            {collapsed ? <ChevronDown size={10} aria-hidden /> : <ChevronUp size={10} aria-hidden />}
          </button>
        </div>

        {showFilters && (
          <div className="bookmarks-filters">
            {/* Region filter */}
            {uniqueRegions.length > 1 && (
              <div className="bookmarks-filter-row">
                <label className="micro" htmlFor="bm-filter-region">{t('bookmarks.filterRegion', 'Region')}</label>
                <select
                  id="bm-filter-region"
                  className="bookmarks-filter-select"
                  value={filterRegion}
                  onChange={(e) => setFilterRegion(e.target.value)}
                >
                  <option value="">{t('bookmarks.filterAll', 'All regions')}</option>
                  {uniqueRegions.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Severity filter */}
            <div className="bookmarks-filter-row">
              <label className="micro" htmlFor="bm-filter-sev">{t('bookmarks.filterSeverity', 'Severity')}</label>
              <select
                id="bm-filter-sev"
                className="bookmarks-filter-select"
                value={filterMinSeverity}
                onChange={(e) => setFilterMinSeverity(Number(e.target.value))}
              >
                {SEVERITY_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>{o.label}</option>
                ))}
              </select>
            </div>

            {/* Date range filter */}
            <div className="bookmarks-filter-row">
              <label className="micro">{t('bookmarks.filterDate', 'Date range')}</label>
              <div className="bookmarks-filter-date-row">
                <input
                  type="date"
                  className="bookmarks-filter-date"
                  value={filterDateFrom}
                  onChange={(e) => setFilterDateFrom(e.target.value)}
                  aria-label={t('bookmarks.filterDateFrom', 'From date')}
                />
                <span className="micro" style={{ color: 'var(--ink-3)' }}>–</span>
                <input
                  type="date"
                  className="bookmarks-filter-date"
                  value={filterDateTo}
                  onChange={(e) => setFilterDateTo(e.target.value)}
                  aria-label={t('bookmarks.filterDateTo', 'To date')}
                />
              </div>
            </div>

            {/* Clear filters button */}
            {(filterRegion || filterMinSeverity > 0 || filterDateFrom || filterDateTo) && (
              <button
                type="button"
                className="bookmarks-filter-clear"
                onClick={() => {
                  setFilterRegion('');
                  setFilterMinSeverity(0);
                  setFilterDateFrom('');
                  setFilterDateTo('');
                }}
              >
                <X size={10} aria-hidden />
                {t('bookmarks.filterClear', 'Clear filters')}
              </button>
            )}
          </div>
        )}

        {!collapsed && (
          <>
            {isLoading && (
              <div className="saved-views-loading">
                <span className="spin" style={{ display: 'inline-block' }}>⟳</span>
              </div>
            )}

            {!isLoading && filteredBookmarks.length === 0 && bookmarks.length === 0 && (
              <div className="saved-views-empty">
                {t('bookmarks.emptyHint', 'Bookmark stories with b or the bookmark icon')}
              </div>
            )}

            {!isLoading && filteredBookmarks.length === 0 && bookmarks.length > 0 && (
              <div className="saved-views-empty">
                {t('bookmarks.noFilteredBookmarks', 'No bookmarks match the current filters')}
              </div>
            )}

            {!isLoading && filteredBookmarks.length > 0 && (
              <ul className="bookmarks-list" role="list">
                {filteredBookmarks.map((bm) => {
                  const sev = ((bm.severity ?? 0) / 10).toFixed(1);
                  let sevClass = 'green';
                  if (bm.severity >= 85) sevClass = 'black';
                  else if (bm.severity >= 70) sevClass = 'red';
                  else if (bm.severity >= 40) sevClass = 'amber';
                  return (
                    <li key={bm.id} className="bookmarks-item">
                      <button
                        type="button"
                        className="saved-views-btn"
                        onClick={() => handleSelect(bm)}
                        title={bm.storyTitle}
                      >
                        <span className="bookmarks-item-title">{bm.storyTitle}</span>
                        <span className="bookmarks-item-meta">
                          {bm.region && <span className="bookmarks-item-region">{bm.region}</span>}
                          <span className={`sev-pill sev-${sevClass}`}>SEV {sev}</span>
                          <span className="bookmarks-item-ago">{ago(bm.bookmarkedAt)}</span>
                        </span>
                      </button>
                      <button
                        type="button"
                        className="saved-views-delete"
                        onClick={(e) => handleRemove(e, bm)}
                        title={t('watchlist.remove', 'Remove from watchlist')}
                        aria-label={t('watchlist.remove', 'Remove from watchlist')}
                        style={{ opacity: 1 }}
                      >
                        <X size={10} />
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </>
        )}
      </SignedIn>

      <SignedOut>
        {needsAuth && (
          <div className="saved-views-login-prompt">
            <LogIn size={10} aria-hidden />
            <span>{t('bookmarks.signInPrompt', 'Sign in to bookmark stories')}</span>
          </div>
        )}
      </SignedOut>
    </div>
  );
}
