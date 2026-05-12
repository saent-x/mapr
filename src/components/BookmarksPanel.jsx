import React, { useMemo, useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BookmarkCheck, Filter, X, ChevronDown, ChevronUp, Crown, CheckCircle2, Star, FileText, Tag, Download, CheckSquare, Square, Trash2 } from 'lucide-react';
import useBookmarks from '../hooks/useBookmarks';
import useUIStore from '../stores/uiStore';
import { exportBookmarksToCSV, exportBookmarksToJSON, parseTagsInput } from '../utils/bookmarkExport.js';

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
  const navigate = useNavigate();
  const location = useLocation();
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
    filterStatus,
    setFilterStatus,
    filterPriority,
    setFilterPriority,
    toggleBookmark,
    updateBookmark,
    bulkUpdate,
    bulkDelete,
  } = useBookmarks();

  const [collapsed, setCollapsed] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [bulkTagInput, setBulkTagInput] = useState('');
  const [editingTagsFor, setEditingTagsFor] = useState(null);
  const [tagDraft, setTagDraft] = useState('');
  const selectStory = useUIStore((s) => s.selectStory);

  const selectedCount = selectedIds.size;
  const toggleSelectAll = () => {
    if (selectedCount === filteredBookmarks.length) setSelectedIds(new Set());
    else setSelectedIds(new Set(filteredBookmarks.map((b) => b.id)));
  };
  const toggleItem = (id) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  const clearSelection = () => { setSelectedIds(new Set()); setSelectMode(false); };
  const handleBulkArchive = async () => {
    if (!selectedCount) return;
    await bulkUpdate([...selectedIds], { status: 'archived' }).catch(() => {});
    clearSelection();
  };
  const handleBulkDelete = async () => {
    if (!selectedCount) return;
    if (!window.confirm(t('bookmarks.bulkDeleteConfirm', { count: selectedCount, defaultValue: `Delete ${selectedCount} bookmarks?` }))) return;
    await bulkDelete([...selectedIds]).catch(() => {});
    clearSelection();
  };
  const handleBulkAddTags = async () => {
    const tags = parseTagsInput(bulkTagInput);
    if (!tags.length || !selectedCount) return;
    await bulkUpdate([...selectedIds], { addTags: tags }).catch(() => {});
    setBulkTagInput('');
  };
  const handleEditTags = (bm) => {
    setEditingTagsFor(bm.id);
    setTagDraft(Array.isArray(bm.tags) ? bm.tags.join(', ') : '');
  };
  const handleSaveTagsForBookmark = async (bm) => {
    const tags = parseTagsInput(tagDraft);
    await updateBookmark(bm.id, { tags }).catch(() => {});
    setEditingTagsFor(null);
  };

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

  const handleStatusToggle = async (e, bookmark) => {
    e.stopPropagation();
    e.preventDefault();
    await updateBookmark(bookmark.id, { status: bookmark.status === 'read' ? 'unread' : 'read' }).catch(() => {});
  };

  const handlePriorityToggle = async (e, bookmark) => {
    e.stopPropagation();
    e.preventDefault();
    await updateBookmark(bookmark.id, { priority: bookmark.priority === 'high' ? 'normal' : 'high' }).catch(() => {});
  };

  const handleNoteChange = async (bookmark, note) => {
    await updateBookmark(bookmark.id, { note }).catch(() => {});
  };

  const handleSignIn = () => {
    const returnUrl = encodeURIComponent(location.pathname + location.search);
    navigate(`/login?returnUrl=${returnUrl}`);
  };

  if (needsAuth) {
    return (
      <div className="bookmarks-sidebar sidebar-pro-feature-slot">
        <button
          type="button"
          className="sidebar-pro-feature-action"
          onClick={handleSignIn}
          title={t('bookmarks.signInPrompt', 'Sign in to bookmark stories')}
          aria-label={t('bookmarks.signInPrompt', 'Sign in to bookmark stories')}
        >
          <BookmarkCheck size={18} aria-hidden />
          <span className="sidebar-pro-feature-label">{t('bookmarks.sidebarTitle', 'Bookmarks')}</span>
          <span className="sidebar-pro-badge" aria-label="Pro feature">
            <Crown size={7} aria-hidden />
          </span>
        </button>
      </div>
    );
  }

  return (
    <div className="bookmarks-sidebar">
      <div className="saved-views-header micro">
        <BookmarkCheck size={12} aria-hidden />
        <span>{t('bookmarks.sidebarTitle', 'BOOKMARKS')}</span>
        {filteredBookmarks.length > 0 && (
          <span
            className="saved-views-count sidebar-section-count-badge"
            aria-label={t('bookmarks.countAriaLabel', { count: filteredBookmarks.length, defaultValue: `${filteredBookmarks.length} bookmarks` })}
          >
            {filteredBookmarks.length}
          </span>
        )}
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
          onClick={() => { setSelectMode((v) => !v); if (selectMode) setSelectedIds(new Set()); }}
          aria-label={selectMode ? t('bookmarks.exitSelect', 'Exit selection') : t('bookmarks.enterSelect', 'Select bookmarks')}
          title={selectMode ? t('bookmarks.exitSelect', 'Exit selection') : t('bookmarks.enterSelect', 'Select')}
          data-active={selectMode ? 'true' : undefined}
          data-testid="bookmarks-select-toggle"
        >
          <CheckSquare size={10} aria-hidden />
        </button>
        <button
          type="button"
          className="alert-rules-toggle"
          onClick={() => exportBookmarksToCSV(filteredBookmarks)}
          aria-label={t('bookmarks.exportCsv', 'Export CSV')}
          title={t('bookmarks.exportCsv', 'Export CSV')}
          disabled={!filteredBookmarks.length}
          data-testid="bookmarks-export-csv"
        >
          <Download size={10} aria-hidden />
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

      {selectMode && !collapsed && (
        <div className="bookmarks-bulk-bar" data-testid="bookmarks-bulk-bar">
          <button
            type="button"
            className="bookmarks-bulk-btn"
            onClick={toggleSelectAll}
            title={selectedCount === filteredBookmarks.length ? t('bookmarks.deselectAll', 'Deselect all') : t('bookmarks.selectAll', 'Select all')}
          >
            <CheckSquare size={10} aria-hidden />
            <span>{selectedCount}/{filteredBookmarks.length}</span>
          </button>
          <input
            type="text"
            className="bookmarks-bulk-tag-input"
            placeholder={t('bookmarks.bulkTagPlaceholder', 'add tags…')}
            value={bulkTagInput}
            onChange={(e) => setBulkTagInput(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleBulkAddTags(); }}
            disabled={!selectedCount}
            aria-label={t('bookmarks.bulkTagPlaceholder', 'add tags…')}
          />
          <button
            type="button"
            className="bookmarks-bulk-btn"
            onClick={handleBulkAddTags}
            disabled={!selectedCount || !bulkTagInput.trim()}
            title={t('bookmarks.bulkAddTag', 'Add tags')}
          >
            <Tag size={10} aria-hidden /> +
          </button>
          <button
            type="button"
            className="bookmarks-bulk-btn"
            onClick={handleBulkArchive}
            disabled={!selectedCount}
            title={t('bookmarks.bulkArchive', 'Archive selected')}
          >
            {t('bookmarks.archive', 'Archive')}
          </button>
          <button
            type="button"
            className="bookmarks-bulk-btn bookmarks-bulk-danger"
            onClick={handleBulkDelete}
            disabled={!selectedCount}
            title={t('bookmarks.bulkDelete', 'Delete selected')}
          >
            <Trash2 size={10} aria-hidden />
          </button>
        </div>
      )}

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

          <div className="bookmarks-filter-row bookmarks-filter-split">
            <label className="micro" htmlFor="bm-filter-status">{t('bookmarks.filterStatus', 'Status')}</label>
            <select
              id="bm-filter-status"
              className="bookmarks-filter-select"
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
            >
              <option value="all">{t('bookmarks.allStatuses', 'All status')}</option>
              <option value="unread">{t('bookmarks.unread', 'Unread')}</option>
              <option value="read">{t('bookmarks.read', 'Read')}</option>
              <option value="archived">{t('bookmarks.archived', 'Archived')}</option>
            </select>
          </div>
          <div className="bookmarks-filter-row bookmarks-filter-split">
            <label className="micro" htmlFor="bm-filter-priority">{t('bookmarks.filterPriority', 'Priority')}</label>
            <select
              id="bm-filter-priority"
              className="bookmarks-filter-select"
              value={filterPriority}
              onChange={(e) => setFilterPriority(e.target.value)}
            >
              <option value="all">{t('bookmarks.allPriorities', 'All priority')}</option>
              <option value="high">{t('bookmarks.highPriority', 'High')}</option>
              <option value="normal">{t('bookmarks.normalPriority', 'Normal')}</option>
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
          {(filterRegion || filterMinSeverity > 0 || filterDateFrom || filterDateTo || filterStatus !== 'all' || filterPriority !== 'all') && (
            <button
              type="button"
              className="bookmarks-filter-clear"
              onClick={() => {
                setFilterRegion('');
                setFilterMinSeverity(0);
                setFilterDateFrom('');
                setFilterDateTo('');
                setFilterStatus('all');
                setFilterPriority('all');
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
                const isSelected = selectedIds.has(bm.id);
                const tagsList = Array.isArray(bm.tags) ? bm.tags : [];
                return (
                  <li key={bm.id} className={`bookmarks-item${isSelected ? ' is-selected' : ''}`}>
                    {selectMode && (
                      <button
                        type="button"
                        className="bookmarks-select-cb"
                        onClick={() => toggleItem(bm.id)}
                        aria-label={isSelected ? t('bookmarks.deselect', 'Deselect') : t('bookmarks.select', 'Select')}
                        aria-pressed={isSelected}
                      >
                        {isSelected ? <CheckSquare size={12} aria-hidden /> : <Square size={12} aria-hidden />}
                      </button>
                    )}
                    <button
                      type="button"
                      className="bookmarks-item-main"
                      onClick={() => (selectMode ? toggleItem(bm.id) : handleSelect(bm))}
                      title={bm.storyTitle}
                    >
                      <span className="bookmarks-item-header">
                        <span className="bookmarks-item-title">{bm.storyTitle}</span>
                        <span className={`sev-pill sev-${sevClass} bookmarks-severity-pill`}>SEV {sev}</span>
                      </span>
                      {bm.storySummary && <span className="bookmarks-item-summary">{bm.storySummary}</span>}
                      <span className="bookmarks-item-meta">
                        {bm.region && <span className="bookmarks-item-region">{bm.region}</span>}
                        <span className={`bookmark-status-chip is-${bm.status}`}>{bm.status}</span>
                        {bm.priority === 'high' && <span className="bookmark-priority-chip"><Star size={8} aria-hidden />high</span>}
                        <span className="bookmarks-item-ago">{ago(bm.bookmarkedAt)}</span>
                      </span>
                      {tagsList.length > 0 && (
                        <span className="bookmarks-item-tags">
                          {tagsList.map((tag) => (
                            <span key={tag} className="bookmark-tag-chip"><Tag size={7} aria-hidden />{tag}</span>
                          ))}
                        </span>
                      )}
                      {bm.note && <span className="bookmarks-item-note"><FileText size={8} aria-hidden />{bm.note}</span>}
                    </button>
                    <div className="bookmarks-item-actions">
                      <button
                        type="button"
                        className="bookmark-workflow-btn"
                        onClick={(e) => handleStatusToggle(e, bm)}
                        title={bm.status === 'read' ? t('bookmarks.markUnread', 'Mark unread') : t('bookmarks.markRead', 'Mark read')}
                        aria-label={bm.status === 'read' ? t('bookmarks.markUnread', 'Mark unread') : t('bookmarks.markRead', 'Mark read')}
                      >
                        <CheckCircle2 size={10} />
                      </button>
                      <button
                        type="button"
                        className="bookmark-workflow-btn"
                        data-active={bm.priority === 'high' ? 'true' : undefined}
                        onClick={(e) => handlePriorityToggle(e, bm)}
                        title={t('bookmarks.togglePriority', 'Toggle priority')}
                        aria-label={t('bookmarks.togglePriority', 'Toggle priority')}
                      >
                        <Star size={10} />
                      </button>
                      <button
                        type="button"
                        className="bookmark-workflow-btn"
                        data-active={editingTagsFor === bm.id ? 'true' : undefined}
                        onClick={(e) => { e.stopPropagation(); editingTagsFor === bm.id ? setEditingTagsFor(null) : handleEditTags(bm); }}
                        title={t('bookmarks.editTags', 'Edit tags')}
                        aria-label={t('bookmarks.editTags', 'Edit tags')}
                      >
                        <Tag size={10} />
                      </button>
                      <button
                        type="button"
                        className="bookmark-workflow-btn bookmark-remove-btn"
                        onClick={(e) => handleRemove(e, bm)}
                        title={t('watchlist.remove', 'Remove from watchlist')}
                        aria-label={t('watchlist.remove', 'Remove from watchlist')}
                      >
                        <X size={10} />
                      </button>
                    </div>
                    {editingTagsFor === bm.id && (
                      <div className="bookmark-tag-editor" onClick={(e) => e.stopPropagation()}>
                        <input
                          type="text"
                          className="bookmark-tag-input"
                          value={tagDraft}
                          onChange={(e) => setTagDraft(e.target.value)}
                          onKeyDown={(e) => { if (e.key === 'Enter') handleSaveTagsForBookmark(bm); if (e.key === 'Escape') setEditingTagsFor(null); }}
                          placeholder={t('bookmarks.tagInputPlaceholder', 'tag1, tag2, …')}
                          autoFocus
                        />
                        <button
                          type="button"
                          className="bookmark-workflow-btn"
                          onClick={() => handleSaveTagsForBookmark(bm)}
                          aria-label={t('bookmarks.saveTags', 'Save tags')}
                        >
                          <CheckCircle2 size={10} />
                        </button>
                      </div>
                    )}
                    <textarea
                      className="bookmark-note-input"
                      defaultValue={bm.note}
                      rows={1}
                      maxLength={180}
                      placeholder={t('bookmarks.notePlaceholder', 'Add analyst note')}
                      onBlur={(e) => handleNoteChange(bm, e.target.value)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </li>
                );
              })}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
