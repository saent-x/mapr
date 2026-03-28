import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, MapPin, Tag, User, X, Plus, Trash2 } from 'lucide-react';
import useWatchStore from '../stores/watchStore.js';

const TYPE_ICONS = {
  region: MapPin,
  topic: Tag,
  entity: User,
};

const TYPE_COLORS = {
  region: '#00d4ff',
  topic: '#00e5a0',
  entity: '#ffaa33',
};

/**
 * WatchlistPanel — sidebar panel showing all watched items with article counts.
 * Users can add/remove regions, topics, or entities.
 */
const WatchlistPanel = ({ isOpen, onClose, onRegionSelect }) => {
  const { t } = useTranslation();
  const { watchItems, matchCounts, notifications, removeWatch, addWatch, clearAll, clearNotifications } = useWatchStore();

  const [addType, setAddType] = useState('topic');
  const [addValue, setAddValue] = useState('');

  const handleAdd = useCallback((e) => {
    e.preventDefault();
    if (!addValue.trim()) return;
    addWatch(addType, addValue.trim(), addValue.trim());
    setAddValue('');
  }, [addType, addValue, addWatch]);

  const handleItemClick = useCallback((item) => {
    if (item.type === 'region' && onRegionSelect) {
      onRegionSelect(item.value);
    }
  }, [onRegionSelect]);

  const totalNotifications = notifications.reduce((sum, n) => sum + n.newCount, 0);

  if (!isOpen) return null;

  return (
    <div className="watchlist-panel" role="complementary" aria-label={t('watchlist.title')}>
      {/* Header */}
      <div className="watchlist-panel-header">
        <div className="watchlist-panel-title-row">
          <Eye size={16} className="watchlist-panel-icon" />
          <h2 className="watchlist-panel-title">{t('watchlist.title')}</h2>
          <button
            className="watchlist-panel-close"
            onClick={onClose}
            aria-label={t('panel.closePanel')}
          >
            <X size={14} />
          </button>
        </div>
        <div className="watchlist-panel-summary">
          <span className="watchlist-panel-badge">
            {watchItems.length} {t('watchlist.items')}
          </span>
          {totalNotifications > 0 && (
            <span className="watchlist-panel-badge watchlist-panel-badge--new">
              {totalNotifications} {t('watchlist.newMatches')}
            </span>
          )}
        </div>
      </div>

      {/* Add form */}
      <form className="watchlist-add-form" onSubmit={handleAdd}>
        <select
          className="watchlist-add-type"
          value={addType}
          onChange={(e) => setAddType(e.target.value)}
          aria-label={t('watchlist.typeLabel')}
        >
          <option value="topic">{t('watchlist.typeTopic')}</option>
          <option value="region">{t('watchlist.typeRegion')}</option>
          <option value="entity">{t('watchlist.typeEntity')}</option>
        </select>
        <input
          className="watchlist-add-input"
          type="text"
          value={addValue}
          onChange={(e) => setAddValue(e.target.value)}
          placeholder={
            addType === 'region'
              ? t('watchlist.placeholderRegion')
              : addType === 'entity'
                ? t('watchlist.placeholderEntity')
                : t('watchlist.placeholderTopic')
          }
          aria-label={t('watchlist.addLabel')}
        />
        <button
          className="watchlist-add-btn"
          type="submit"
          disabled={!addValue.trim()}
          aria-label={t('watchlist.addAction')}
        >
          <Plus size={14} />
        </button>
      </form>

      {/* Watch list */}
      <div className="watchlist-panel-body">
        {watchItems.length === 0 ? (
          <div className="watchlist-panel-empty">
            <EyeOff size={24} />
            <p>{t('watchlist.empty')}</p>
            <p className="watchlist-panel-hint">{t('watchlist.emptyHint')}</p>
          </div>
        ) : (
          <>
            <ul className="watchlist-panel-list">
              {watchItems.map((item) => {
                const Icon = TYPE_ICONS[item.type] || Tag;
                const color = TYPE_COLORS[item.type] || '#888';
                const count = matchCounts[item.id] || 0;
                const notification = notifications.find((n) => n.watchId === item.id);

                return (
                  <li key={item.id} className="watchlist-panel-item">
                    <button
                      className="watchlist-panel-btn"
                      onClick={() => handleItemClick(item)}
                      aria-label={`${item.label}: ${count} ${t('watchlist.articles')}`}
                    >
                      <span
                        className="watchlist-panel-indicator"
                        style={{ background: color }}
                      />
                      <Icon size={12} style={{ color, flexShrink: 0 }} />
                      <div className="watchlist-panel-item-content">
                        <span className="watchlist-panel-label">{item.label}</span>
                        <span className="watchlist-panel-type">{t(`watchlist.type${item.type.charAt(0).toUpperCase() + item.type.slice(1)}`)}</span>
                      </div>
                      <div className="watchlist-panel-item-meta">
                        <span className="watchlist-panel-count">{count}</span>
                        {notification && (
                          <span className="watchlist-panel-new-badge">
                            +{notification.newCount}
                          </span>
                        )}
                      </div>
                    </button>
                    <button
                      className="watchlist-panel-remove"
                      onClick={() => removeWatch(item.id)}
                      aria-label={t('watchlist.remove')}
                    >
                      <X size={10} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {watchItems.length > 0 && (
              <button className="watchlist-clear-all" onClick={clearAll}>
                <Trash2 size={10} /> {t('watchlist.clearAll')}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default WatchlistPanel;
