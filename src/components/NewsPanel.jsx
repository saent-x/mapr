import React, { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { X, ExternalLink } from 'lucide-react';
import { format, formatDistanceToNow } from 'date-fns';
import { enUS, es, fr, ar, zhCN } from 'date-fns/locale';
import { getSeverityMeta } from '../utils/mockData';

const DATE_LOCALES = { en: enUS, es, fr, ar, zh: zhCN };

const NewsPanel = ({ isOpen, regionData, news, selectedStoryId, onStorySelect, onClose }) => {
  const { t, i18n } = useTranslation();
  const [expandedId, setExpandedId] = useState(null);
  const expandedRef = useRef(null);

  const regionName = regionData?.region || t('panel.closePanel');
  const sevMeta = getSeverityMeta(regionData?.averageSeverity || 0);
  const locale = DATE_LOCALES[i18n.language] || enUS;

  useEffect(() => {
    if (expandedRef.current) {
      expandedRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }
  }, [expandedId]);

  // Reset expanded when region changes
  useEffect(() => {
    setExpandedId(null);
  }, [regionData?.region]);

  const handleCardClick = (story) => {
    onStorySelect(story);
    setExpandedId((prev) => (prev === story.id ? null : story.id));
  };

  return (
    <div className={`news-panel ${isOpen ? 'is-open' : ''}`}>
      <div className="news-panel-header">
        <div className="news-panel-title">
          <h2>{regionName}</h2>
          <button className="news-panel-close" onClick={onClose} aria-label={t('panel.closePanel')}>
            <X size={16} />
          </button>
        </div>

        {regionData && (
          <div className="news-panel-meta">
            <span
              className="meta-badge"
              style={{ background: sevMeta.muted, color: sevMeta.accent }}
            >
              {t(`legend.${sevMeta.labelKey}`)}
            </span>
            <span
              className="meta-badge"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
            >
              {regionData.count} {regionData.count === 1 ? t('panel.report') : t('panel.reports')}
            </span>
            <span
              className="meta-badge"
              style={{ background: 'rgba(255,255,255,0.04)', color: 'var(--text-secondary)' }}
            >
              {t('panel.avg')} {Math.round(regionData.averageSeverity)}
            </span>
          </div>
        )}
      </div>

      <div className="news-panel-list">
        {news.map((story) => {
          const meta = getSeverityMeta(story.severity);
          const isExpanded = expandedId === story.id;

          return (
            <div
              key={story.id}
              ref={isExpanded ? expandedRef : null}
              className={`news-card ${selectedStoryId === story.id ? 'is-active' : ''}`}
              role="button"
              tabIndex={0}
              onClick={() => handleCardClick(story)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCardClick(story); }}
            >
              <div className="news-card-top">
                <span
                  className="news-card-severity"
                  style={{ background: meta.muted, color: meta.accent }}
                >
                  {t(`legend.${meta.labelKey}`)}
                </span>
                <span className="news-card-time">
                  {formatDistanceToNow(new Date(story.publishedAt), { locale, addSuffix: true })}
                </span>
              </div>
              <h3>{story.title}</h3>
              {story.summary !== story.title && <p>{story.summary}</p>}
              <div className="news-card-footer">
                <span>{story.locality}</span>
                <span>{story.category}</span>
              </div>

              {isExpanded && (
                <div className="news-card-expanded" onClick={(e) => e.stopPropagation()}>
                  {story.socialimage && (
                    <img
                      className="news-card-image"
                      src={story.socialimage}
                      alt=""
                      loading="lazy"
                      onError={(e) => { e.target.style.display = 'none'; }}
                    />
                  )}
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.source')}</span>
                    <span>{story.source || '—'}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.published')}</span>
                    <span>{format(new Date(story.publishedAt), 'PPp', { locale })}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.category')}</span>
                    <span>{story.category}</span>
                  </div>
                  <div className="news-card-detail-row">
                    <span className="news-card-detail-label">{t('article.severity')}</span>
                    <span style={{ color: meta.accent }}>{story.severity}</span>
                  </div>
                  {story.url && (
                    <a
                      className="news-card-read-more"
                      href={story.url}
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <ExternalLink size={13} />
                      {t('article.readFull')}
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default NewsPanel;
