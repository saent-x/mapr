import React, { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Archive, Clock, ExternalLink, Sparkles, ShieldQuestion } from 'lucide-react';
import { fetchEventCredibility } from '../services/backendService.js';

function fmtDate(iso) {
  if (!iso) return '—';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '—';
  return new Date(ts).toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function relative(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

function waybackUrl(url) {
  if (!url) return '';
  return `https://web.archive.org/web/*/${encodeURIComponent(url).replace(/%2F/g, '/')}`;
}

function waybackSaveUrl(url) {
  if (!url) return '';
  return `https://web.archive.org/save/${url}`;
}

function aiContentSignals(article) {
  const signals = [];
  const text = (article?.title || '') + ' ' + (article?.summary || '');
  if (/\bas an AI\b|\bas a language model\b|\bI cannot\b/i.test(text)) signals.push('llm-disclaimer');
  if ((article?.url || '').includes('chat.openai.com')) signals.push('chatgpt-host');
  // Extremely conservative — surface only obvious tells. Real detection
  // requires a classifier and will land with the AI worker.
  return signals;
}

export default function VerificationHelper({ event }) {
  const { t } = useTranslation();
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchEventCredibility(event.id)
      .then((res) => { if (!cancelled) setData(res); })
      .catch((err) => { if (!cancelled) setError(err.message || 'Failed to load verification'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event?.id]);

  const orderedSources = useMemo(() => {
    if (!data?.sources) return [];
    return [...data.sources].sort((a, b) => {
      const ta = a.firstPublishedAt ? Date.parse(a.firstPublishedAt) : Infinity;
      const tb = b.firstPublishedAt ? Date.parse(b.firstPublishedAt) : Infinity;
      return ta - tb;
    });
  }, [data]);

  if (!event?.id) return null;

  return (
    <section className="event-detail-section verification-section" data-testid="verification-panel">
      <h2 className="event-detail-section-title verification-title">
        <ShieldQuestion size={12} aria-hidden /> {t('verification.title', 'Verify this story')}
      </h2>

      {loading && (
        <div className="verification-loading mono">{t('verification.loading', 'CHECKING ARCHIVES…')}</div>
      )}

      {error && !loading && (
        <div className="verification-error mono" role="alert">{error}</div>
      )}

      {!loading && data && data.uniqueSourceCount === 0 && (
        <div className="verification-empty mono">{t('verification.noSources', 'No source data to verify.')}</div>
      )}

      {!loading && orderedSources.length > 0 && (
        <>
          <p className="micro verification-intro">
            {t('verification.intro', 'Cross-check the timeline below. Sources are listed in first-publish order so you can see who broke the story and how the wire wave spread.')}
          </p>

          <ol className="verification-timeline">
            {orderedSources.map((src, idx) => {
              const signals = aiContentSignals(src.latestArticle);
              return (
                <li key={src.sourceKey} className="verification-timeline-item">
                  <div className="verification-marker">
                    <span className="verification-marker-num">{idx + 1}</span>
                    {idx === 0 && (
                      <span className="verification-first-badge">{t('verification.firstMover', 'FIRST')}</span>
                    )}
                  </div>
                  <div className="verification-row-body">
                    <div className="verification-row-head">
                      <span className="verification-source-name">{src.sourceName}</span>
                      <span className="mono micro">
                        <Clock size={9} aria-hidden /> {fmtDate(src.firstPublishedAt)} ({relative(src.firstPublishedAt)})
                      </span>
                    </div>
                    <div className="verification-row-actions">
                      {src.latestArticle?.url && (
                        <a
                          href={src.latestArticle.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mono micro verification-link"
                        >
                          <ExternalLink size={9} aria-hidden /> {t('verification.openOriginal', 'Open original')}
                        </a>
                      )}
                      {src.latestArticle?.url && (
                        <a
                          href={waybackUrl(src.latestArticle.url)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mono micro verification-link"
                        >
                          <Archive size={9} aria-hidden /> {t('verification.wayback', 'Wayback')}
                        </a>
                      )}
                      {src.latestArticle?.url && (
                        <a
                          href={waybackSaveUrl(src.latestArticle.url)}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="mono micro verification-link"
                          title={t('verification.saveTooltip', 'Save a fresh snapshot to archive.org')}
                        >
                          <Archive size={9} aria-hidden /> {t('verification.save', 'Snapshot')}
                        </a>
                      )}
                    </div>
                    {signals.length > 0 && (
                      <div className="verification-ai-flag mono micro" title={signals.join(', ')}>
                        <Sparkles size={9} aria-hidden /> {t('verification.aiSignal', 'AI-content signals detected')}
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>

          {data.singleSourceWarning && (
            <div className="verification-warning mono micro">
              {t('verification.singleSource', 'Only one outlet has reported this — no independent corroboration yet.')}
            </div>
          )}
        </>
      )}
    </section>
  );
}
