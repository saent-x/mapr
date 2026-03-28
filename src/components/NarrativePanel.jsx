import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { formatDistanceToNow, format } from 'date-fns';
import { enUS, es, fr, ar, zhCN } from 'date-fns/locale';
import { Clock, Globe, Radio, Layers } from 'lucide-react';
import { buildNarrativeTimeline } from '../utils/narrativeHelpers.js';

const DATE_LOCALES = { en: enUS, es, fr, ar, zh: zhCN };

const SOURCE_TYPE_COLORS = {
  official: '#00e5a0',
  wire: '#00d4ff',
  global: '#7c7cff',
  regional: '#ffaa00',
  local: '#ff7eb3',
  unknown: '#666',
};

/** Safe date formatting helpers */
function safeDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

function safeTimeAgo(value, opts) {
  const d = safeDate(value);
  return d ? formatDistanceToNow(d, opts) : '—';
}

function safeFormat(value, fmt, opts) {
  const d = safeDate(value);
  return d ? format(d, fmt, opts) : '—';
}

function formatTimeSpan(ms) {
  if (ms <= 0) return '—';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const minutes = Math.floor((ms % (1000 * 60 * 60)) / (1000 * 60));
  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remainHours = hours % 24;
    return remainHours > 0 ? `${days}d ${remainHours}h` : `${days}d`;
  }
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
}

/**
 * NarrativePanel — Displays how a story evolved over time.
 *
 * Shows:
 * - When the event was first reported and by which source
 * - Timeline stages showing the narrative development
 * - Source diversity at each stage (wire / local / regional indicators)
 * - Cross-regional spread if similar events exist in other regions
 */
const NarrativePanel = ({ story, allEvents }) => {
  const { t, i18n } = useTranslation();
  const locale = DATE_LOCALES[i18n.language] || enUS;

  const narrative = useMemo(
    () => buildNarrativeTimeline(story, allEvents),
    [story, allEvents]
  );

  if (!story || !narrative || narrative.stages.length === 0) {
    return null;
  }

  const { stages, diversity, crossRegional, firstReportedAt, timeSpanMs } = narrative;

  return (
    <div className="narrative-panel" role="region" aria-label={t('narrative.label', 'Story narrative')}>
      {/* Header summary */}
      <div className="narrative-header">
        <div className="narrative-header-icon">
          <Clock size={14} />
        </div>
        <div className="narrative-header-text">
          <span className="narrative-header-title">{t('narrative.title', 'Story Timeline')}</span>
          <span className="narrative-header-meta">
            {t('narrative.firstReported', 'First reported')}{' '}
            {safeTimeAgo(firstReportedAt, { locale, addSuffix: true })}
            {timeSpanMs > 0 && (
              <>
                {' · '}
                {t('narrative.span', 'Span')}: {formatTimeSpan(timeSpanMs)}
              </>
            )}
          </span>
        </div>
      </div>

      {/* Source diversity summary */}
      {diversity.length > 0 && (
        <div className="narrative-diversity">
          <div className="narrative-diversity-label">
            <Layers size={11} />
            {t('narrative.sourceDiversity', 'Source Diversity')}
          </div>
          <div className="narrative-diversity-chips">
            {diversity.map((d) => (
              <span
                key={d.type}
                className="narrative-source-chip"
                style={{ borderColor: SOURCE_TYPE_COLORS[d.type] || '#666', color: SOURCE_TYPE_COLORS[d.type] || '#666' }}
              >
                {t(`sourceType.${d.type}`, d.type)} ({d.count})
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Timeline stages */}
      <div className="narrative-timeline">
        {stages.map((stage, idx) => {
          const isFirst = idx === 0;
          const stageArticles = stage.articles || [];
          const stageTypes = [...new Set(stageArticles.map((a) => a.sourceType))];

          return (
            <div key={idx} className={`narrative-stage ${isFirst ? 'is-first' : ''}`}>
              {/* Timeline connector */}
              <div className="narrative-stage-connector">
                <div className={`narrative-stage-dot ${isFirst ? 'is-first' : ''}`} />
                {idx < stages.length - 1 && <div className="narrative-stage-line" />}
              </div>

              {/* Stage content */}
              <div className="narrative-stage-content">
                <div className="narrative-stage-header">
                  <span className="narrative-stage-label">
                    {isFirst
                      ? t('narrative.stageFirst', 'First Report')
                      : stage.label === 'developing'
                        ? t('narrative.stageDeveloping', 'Developing')
                        : t('narrative.stageContinued', 'Continued Coverage')}
                  </span>
                  <span className="narrative-stage-time">
                    {safeFormat(new Date(stage.startTime).toISOString(), 'MMM d, HH:mm', { locale })}
                  </span>
                </div>

                {/* Articles in this stage */}
                <div className="narrative-stage-articles">
                  {stageArticles.map((article, aIdx) => (
                    <div key={article.id || aIdx} className="narrative-article">
                      <span
                        className="narrative-article-type"
                        style={{ color: SOURCE_TYPE_COLORS[article.sourceType] || '#666' }}
                      >
                        {t(`sourceType.${article.sourceType}`, article.sourceType)}
                      </span>
                      <span className="narrative-article-source">{article.source}</span>
                      {article.url && (
                        <a
                          href={article.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="narrative-article-link"
                          title={article.title}
                        >
                          ↗
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {/* Stage source type chips */}
                {stageTypes.length > 1 && (
                  <div className="narrative-stage-types">
                    {stageTypes.map((type) => (
                      <span
                        key={type}
                        className="narrative-type-dot"
                        style={{ background: SOURCE_TYPE_COLORS[type] || '#666' }}
                        title={t(`sourceType.${type}`, type)}
                      />
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Cross-regional spread */}
      {crossRegional.length > 0 && (
        <div className="narrative-cross-regional">
          <div className="narrative-cross-regional-label">
            <Globe size={11} />
            {t('narrative.crossRegional', 'Cross-Regional Spread')}
          </div>
          <div className="narrative-cross-regional-list">
            {crossRegional.map((match) => (
              <div key={match.event.id} className="narrative-cross-item">
                <span className="narrative-cross-region">
                  {match.event.locality || match.event.region || match.event.isoA2}
                </span>
                <span className="narrative-cross-title" title={match.event.title}>
                  {(match.event.title || '').slice(0, 60)}
                  {(match.event.title || '').length > 60 ? '…' : ''}
                </span>
                <span className="narrative-cross-match">
                  {Math.round(match.similarity * 100)}%
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default NarrativePanel;
