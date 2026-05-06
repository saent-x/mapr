import React, { useCallback, useState, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronDown, ChevronUp } from 'lucide-react';
import useWatchStore from '../stores/watchStore.js';
import useUIStore from '../stores/uiStore.js';
import useFilterStore from '../stores/filterStore.js';
import { isoToCountry } from '../utils/geocoder.js';
import { SEVERITY_TIER_NAMES } from '../utils/watchUtils.js';

/* ── Options for rule builder dropdowns ── */
const CATEGORY_OPTIONS = [
  'Conflict', 'Seismic', 'Weather', 'Humanitarian', 'Civil',
  'Health', 'Political', 'Economic', 'Infrastructure', 'Climate', 'General',
];

const SOURCE_TYPE_OPTIONS = [
  'rss', 'gdelt', 'official', 'wire', 'global', 'regional', 'local',
];

const VERIFICATION_OPTIONS = [
  'official', 'verified', 'developing', 'single-source',
];

const RULE_TYPES = [
  { value: 'topic', label: 'watchlist.typeTopic' },
  { value: 'region', label: 'watchlist.typeRegion' },
  { value: 'entity', label: 'watchlist.typeEntity' },
  { value: 'category', label: 'watchlist.typeCategory' },
  { value: 'severity', label: 'watchlist.typeSeverity' },
  { value: 'sourceType', label: 'watchlist.typeSourceType' },
  { value: 'verificationStatus', label: 'watchlist.typeVerification' },
];

/**
 * Format an ISO timestamp as a relative time string (e.g., "2m ago", "1h ago").
 */
function formatRelativeTime(isoString) {
  if (!isoString) return null;
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  if (diffMs < 0) return null;

  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return '<1m';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return `${days}d`;
}

/**
 * Get a human-readable label for a rule's type abbreviation.
 */
function ruleTypeAbbrev(type) {
  switch (type) {
    case 'category': return 'CAT';
    case 'severity': return 'SEV';
    case 'sourceType': return 'SRC';
    case 'verificationStatus': return 'VER';
    case 'region': return 'REG';
    case 'topic': return 'TOP';
    case 'entity': return 'ENT';
    default: return (type || '').slice(0, 3).toUpperCase();
  }
}

/* ── Render ────────────────────────────────────────────────────────────────── */

/**
 * WatchlistPanel — left mini-panel. Shows watched regions / topics / entities /
 * categories / severity thresholds / source types / verification statuses
 * with current article match counts and last-match timestamps.
 * Expand-on-open for add/remove controls with rule builder UI.
 */
const WatchlistPanel = ({ onRegionSelect }) => {
  const { t } = useTranslation();
  const watchItems = useWatchStore((s) => s.watchItems);
  const matchCounts = useWatchStore((s) => s.matchCounts);
  const lastMatchTimestamps = useWatchStore((s) => s.lastMatchTimestamps);
  const removeWatch = useWatchStore((s) => s.removeWatch);
  const addWatch = useWatchStore((s) => s.addWatch);
  const setSearchQuery = useFilterStore((s) => s.setSearchQuery);
  const setEntityFilter = useFilterStore((s) => s.setEntityFilter);

  const [addType, setAddType] = useState('topic');
  const [addValue, setAddValue] = useState('');

  const handleAdd = useCallback((e) => {
    e?.preventDefault?.();
    if (!addValue.trim()) return;
    addWatch(addType, addValue.trim());
    setAddValue('');
  }, [addType, addValue, addWatch]);

  const handleClick = (item) => {
    if (item.type === 'region' && onRegionSelect) {
      onRegionSelect(item.value);
    } else if (item.type === 'topic') {
      setSearchQuery(item.value);
    } else if (item.type === 'entity') {
      setEntityFilter({ id: item.id, name: item.label || item.value, type: 'entity' });
    }
  };

  const collapsed = useUIStore((s) => s.panelCollapsed.watchlist);
  const togglePanelCollapsed = useUIStore((s) => s.togglePanelCollapsed);

  /* ── Decide whether the value field should be a dropdown or text input ── */
  const usesDropdown = addType === 'category' || addType === 'severity' || addType === 'sourceType' || addType === 'verificationStatus';

  const dropdownOptions = useMemo(() => {
    if (addType === 'severity') return SEVERITY_TIER_NAMES;
    if (addType === 'category') return CATEGORY_OPTIONS;
    if (addType === 'sourceType') return SOURCE_TYPE_OPTIONS;
    if (addType === 'verificationStatus') return VERIFICATION_OPTIONS;
    return [];
  }, [addType]);

  const placeholderText = useMemo(() => {
    switch (addType) {
      case 'region': return t('watchlist.placeholderRegion');
      case 'entity': return t('watchlist.placeholderEntity');
      case 'topic': return t('watchlist.placeholderTopic');
      case 'category': return t('watchlist.placeholderCategory');
      case 'severity': return t('watchlist.placeholderSeverity');
      case 'sourceType': return t('watchlist.placeholderSourceType');
      case 'verificationStatus': return t('watchlist.placeholderVerification');
      default: return '';
    }
  }, [addType, t]);

  return (
    <div className="mini-panel" data-collapsed={collapsed || undefined} role="region" aria-label={t('watchlist.toggleLabel')}>
      <div className="panel-header">
        <span className="dot" style={{ background: 'var(--amber)' }} />
        {t('watchlist.toggleLabel')}
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>{watchItems.length}</span>
        <button
          type="button"
          className="panel-collapse-btn"
          onClick={() => togglePanelCollapsed('watchlist')}
          aria-label={collapsed ? 'Expand panel' : 'Collapse panel'}
          aria-expanded={!collapsed}
        >
          {collapsed ? <ChevronDown size={12} aria-hidden /> : <ChevronUp size={12} aria-hidden />}
        </button>
      </div>
      <div className="panel-body" aria-hidden={collapsed || undefined}>
        {watchItems.length === 0 && (
          <div className="mini-panel-empty">WATCHLIST EMPTY</div>
        )}
        {watchItems.map((item) => {
          const count = matchCounts?.[item.id] ?? 0;
          const lastMatch = lastMatchTimestamps?.[item.id] ?? null;
          const relTime = formatRelativeTime(lastMatch);
          const label = item.type === 'region'
            ? (isoToCountry(item.value) || item.label || item.value)
            : (item.label || item.value);
          const abbrev = ruleTypeAbbrev(item.type);
          return (
            <div
              key={item.id}
              className="watchlist-row"
              role="button"
              tabIndex={0}
              aria-label={`${label} (${count})`}
              onClick={() => handleClick(item)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleClick(item); }
              }}
            >
              <span className="code">{abbrev}</span>
              <span className="name">
                {label}
                {relTime && (
                  <span className="watchlist-last-match" title={lastMatch}>
                    {' · '}{relTime}
                  </span>
                )}
              </span>
              <span className="ct">
                {count}
                <button
                  type="button"
                  onClick={(e) => { e.stopPropagation(); removeWatch(item.id); }}
                  aria-label={`Remove ${label}`}
                  style={{ marginLeft: 6, color: 'var(--ink-2)' }}
                >
                  ×
                </button>
              </span>
            </div>
          );
        })}
        <form
          onSubmit={handleAdd}
          className="watchlist-add-form"
          style={{ padding: '8px 10px', borderTop: '1px solid var(--line)', display: 'flex', gap: 4, flexWrap: 'wrap' }}
        >
          <select
            value={addType}
            onChange={(e) => { setAddType(e.target.value); setAddValue(''); }}
            className="chip"
            aria-label={t('watchlist.typeLabel')}
            style={{ background: 'transparent', maxWidth: '100%' }}
          >
            {RULE_TYPES.map((rt) => (
              <option key={rt.value} value={rt.value}>{t(rt.label)}</option>
            ))}
          </select>
          {usesDropdown ? (
            <select
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              aria-label="Watch value"
              style={{
                flex: 1, minWidth: 100, padding: '3px 7px', border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--ink-0)',
                fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-0)', letterSpacing: '0.08em',
              }}
            >
              <option value="">{placeholderText}</option>
              {dropdownOptions.map((opt) => (
                <option key={opt} value={opt}>{opt}</option>
              ))}
            </select>
          ) : (
            <input
              type="text"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder={placeholderText}
              aria-label="Watch value"
              style={{
                flex: 1, minWidth: 80, padding: '3px 7px', border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--ink-0)',
                fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-0)', letterSpacing: '0.08em',
              }}
            />
          )}
          <button type="submit" className="btn primary">{t('watchlist.addAction')}</button>
        </form>
      </div>
    </div>
  );
};

export default WatchlistPanel;
