import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import useWatchStore from '../stores/watchStore.js';
import { isoToCountry } from '../utils/geocoder.js';

/**
 * WatchlistPanel — left mini-panel. Shows watched regions / topics / entities
 * with current article match counts. Expand-on-open for add/remove controls.
 */
const WatchlistPanel = ({ isOpen, onClose, onRegionSelect }) => {
  const { t } = useTranslation();
  const watchItems = useWatchStore((s) => s.watchItems);
  const matchCounts = useWatchStore((s) => s.matchCounts);
  const removeWatch = useWatchStore((s) => s.removeWatch);
  const addWatch = useWatchStore((s) => s.addWatch);

  const [addType, setAddType] = useState('topic');
  const [addValue, setAddValue] = useState('');

  const handleAdd = useCallback((e) => {
    e?.preventDefault?.();
    if (!addValue.trim()) return;
    addWatch(addType, addValue.trim(), addValue.trim());
    setAddValue('');
  }, [addType, addValue, addWatch]);

  const handleClick = (item) => {
    if (item.type === 'region' && onRegionSelect) onRegionSelect(item.value);
  };

  return (
    <div className="mini-panel" role="region" aria-label={t('watchlist.toggleLabel')}>
      <div className="panel-header">
        <span className="dot" style={{ background: 'var(--amber)' }} />
        {t('watchlist.toggleLabel')}
        <span className="spacer" />
        <span style={{ color: 'var(--ink-2)' }}>{watchItems.length}</span>
        {isOpen && (
          <button type="button" onClick={onClose} aria-label={t('panel.closePanel')}>×</button>
        )}
      </div>
      <div className="panel-body" style={isOpen ? { maxHeight: 'none' } : undefined}>
        {watchItems.length === 0 && (
          <div className="mini-panel-empty">WATCHLIST EMPTY</div>
        )}
        {watchItems.map((item) => {
          const count = matchCounts?.[item.id] ?? 0;
          const label = item.type === 'region'
            ? (isoToCountry(item.value) || item.label || item.value)
            : (item.label || item.value);
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
              <span className="code">{item.type.slice(0, 3).toUpperCase()}</span>
              <span className="name">{label}</span>
              <span className="ct">
                {count}
                {isOpen && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); removeWatch(item.id); }}
                    aria-label={`Remove ${label}`}
                    style={{ marginLeft: 6, color: 'var(--ink-2)' }}
                  >
                    ×
                  </button>
                )}
              </span>
            </div>
          );
        })}
        {isOpen && (
          <form
            onSubmit={handleAdd}
            style={{ padding: '8px 10px', borderTop: '1px solid var(--line)', display: 'flex', gap: 4 }}
          >
            <select
              value={addType}
              onChange={(e) => setAddType(e.target.value)}
              className="chip"
              aria-label="Watch type"
              style={{ background: 'transparent' }}
            >
              <option value="topic">TOPIC</option>
              <option value="region">REGION</option>
              <option value="entity">ENTITY</option>
            </select>
            <input
              type="text"
              value={addValue}
              onChange={(e) => setAddValue(e.target.value)}
              placeholder={addType === 'region' ? 'ISO e.g. UKR' : addType === 'entity' ? 'Name' : 'Keyword'}
              aria-label="Watch value"
              style={{
                flex: 1, padding: '3px 7px', border: '1px solid var(--line-2)',
                background: 'var(--bg-2)', color: 'var(--ink-0)',
                fontFamily: 'var(--ff-mono)', fontSize: 'var(--fs-0)', letterSpacing: '0.08em',
              }}
            />
            <button type="submit" className="btn primary">ADD</button>
          </form>
        )}
      </div>
    </div>
  );
};

export default WatchlistPanel;
