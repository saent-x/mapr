import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, ShieldAlert, ShieldX, ExternalLink, AlertTriangle, Info } from 'lucide-react';
import { fetchEventCredibility } from '../services/backendService.js';

function tierIcon(tier) {
  switch (tier) {
    case 'high': return <ShieldCheck size={11} aria-hidden />;
    case 'medium': return <ShieldAlert size={11} aria-hidden />;
    case 'low': return <ShieldX size={11} aria-hidden />;
    default: return <ShieldAlert size={11} aria-hidden />;
  }
}

function tierClass(tier) {
  return `credibility-tier credibility-tier--${tier}`;
}

function biasLabel(bias) {
  if (!bias) return '';
  return String(bias).replace(/[-_]/g, ' ');
}

function formatRelative(iso) {
  if (!iso) return '';
  const ts = typeof iso === 'string' ? Date.parse(iso) : iso;
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function SourceCredibilityPanel({ eventId }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEventCredibility(eventId)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load credibility'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [eventId]);

  if (!eventId) return null;

  return (
    <section className="event-detail-section credibility-section" data-testid="credibility-panel">
      <h2 className="event-detail-section-title">
        {t('credibility.title', 'Source credibility')}
      </h2>

      {loading && (
        <div className="credibility-loading mono">{t('credibility.loading', 'Loading sources…')}</div>
      )}

      {error && !loading && (
        <div className="credibility-error mono" role="alert">{error}</div>
      )}

      {!loading && data && data.uniqueSourceCount === 0 && (
        <div className="credibility-empty mono">{t('credibility.noSources', 'No source data available yet.')}</div>
      )}

      {!loading && data && data.uniqueSourceCount > 0 && (
        <>
          {data.singleSourceWarning && (
            <div className="credibility-warning" data-testid="credibility-single-source">
              <AlertTriangle size={12} aria-hidden />
              <span>{t('credibility.singleSourceWarning', 'Single-source story — not yet corroborated by another outlet.')}</span>
            </div>
          )}

          {data.firstPublisher && (
            <div className="credibility-first">
              <span className="mono micro">{t('credibility.firstPublisher', 'First publisher')}</span>
              <span className="credibility-first-name">{data.firstPublisher.sourceName}</span>
              <span className="mono micro" title={data.firstPublisher.publishedAt}>{formatRelative(data.firstPublisher.publishedAt)}</span>
            </div>
          )}

          <div className="credibility-summary mono micro">
            {t('credibility.outletCount', { count: data.uniqueSourceCount, defaultValue: '{{count}} outlets' })}
          </div>

          <ul className="credibility-source-list" role="list">
            {data.sources.map((src) => (
              <li key={src.sourceKey} className="credibility-source">
                <div className="credibility-source-head">
                  <span className={tierClass(src.reliabilityTier)} title={src.reliabilityTier}>
                    {tierIcon(src.reliabilityTier)}
                    <span>{src.reliabilityTier.toUpperCase()}</span>
                  </span>
                  <span className="credibility-source-name">{src.sourceName}</span>
                  {src.stateMedia && <span className="credibility-flag" title={t('credibility.stateMedia', 'State media')}>{t('credibility.stateMediaShort', 'STATE')}</span>}
                  {src.biasLean && <span className="credibility-flag credibility-flag--bias">{biasLabel(src.biasLean)}</span>}
                </div>
                <div className="credibility-source-meta mono">
                  {src.score != null && (
                    <span title={t('credibility.scoreTooltip', 'Corroboration rate across all stories')}>
                      {Math.round(src.score * 100)}% {t('credibility.corroborated', 'corroborated')}
                    </span>
                  )}
                  {src.totalEvents != null && (
                    <span>· {src.totalEvents} {t('credibility.eventsTracked', 'events tracked')}</span>
                  )}
                  <span>· {src.articleCount} {t('credibility.thisStory', 'this story')}</span>
                </div>
                {src.latestArticle?.url && (
                  <a
                    className="credibility-source-link mono micro"
                    href={src.latestArticle.url}
                    target="_blank"
                    rel="noreferrer noopener"
                  >
                    <ExternalLink size={9} aria-hidden /> {t('credibility.openLatest', 'Open latest')}
                  </a>
                )}
                {src.explanation && (
                  <p className="credibility-source-blurb"><Info size={9} aria-hidden /> {src.explanation}</p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}
