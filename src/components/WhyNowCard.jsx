import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { History, RefreshCcw, AlertTriangle, Sparkles } from 'lucide-react';
import useSubscriptionStore from '../stores/subscriptionStore';
import { fetchWhyNow, regenerateWhyNow } from '../services/backendService.js';

export default function WhyNowCard({ event }) {
  const { t } = useTranslation();
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  useEffect(() => {
    if (!event?.id) return;
    let cancelled = false;
    setLoading(true);
    fetchWhyNow(event.id)
      .then((row) => { if (!cancelled) setData(row); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event?.id]);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const row = await regenerateWhyNow(event.id, { force: true });
      setData(row);
    } catch (err) {
      setError(err.message || 'Failed');
      setErrorCode(err.code || err.payload?.code || null);
    } finally {
      setBusy(false);
    }
  }, [event?.id]);

  if (!event?.id) return null;

  const hasContext = Boolean(data?.context);

  return (
    <section className="event-detail-section why-now-section" data-testid="why-now">
      <header className="event-detail-section-head">
        <h2 className="event-detail-section-title">
          <History size={12} aria-hidden /> {t('whyNow.title')}
        </h2>
        {(isAuthenticated && hasContext) && (
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={handleGenerate}
            disabled={busy}
            title={t('whyNow.regenerate')}
            aria-label={t('whyNow.regenerate')}
          >
            <RefreshCcw size={10} aria-hidden />
          </button>
        )}
      </header>

      {loading && <div className="mono micro">{t('whyNow.loading')}</div>}

      {!loading && !hasContext && isAuthenticated && (
        <div className="why-now-empty">
          <p>{t('whyNow.notRunYet')}</p>
          <button
            type="button"
            className="btn primary"
            onClick={handleGenerate}
            disabled={busy}
            data-testid="why-now-generate"
          >
            <Sparkles size={11} aria-hidden /> {busy ? t('whyNow.generating') : t('whyNow.generate')}
          </button>
        </div>
      )}

      {!loading && !hasContext && !isAuthenticated && (
        <div className="why-now-empty mono micro">{t('whyNow.signInToGenerate')}</div>
      )}

      {hasContext && (
        <>
          <p className="why-now-context">{data.context}</p>
          {Array.isArray(data.precedents) && data.precedents.length > 0 && (
            <div className="why-now-precedents">
              <div className="mono micro">{t('whyNow.precedentsHeading')}</div>
              <ul>
                {data.precedents.map((p, i) => (
                  <li key={`pr-${i}`}>
                    {p.eventId ? (
                      <Link to={`/event/${encodeURIComponent(p.eventId)}`}>{p.label}</Link>
                    ) : (
                      <span>{p.label}</span>
                    )}
                    {p.approxDate && <span className="mono micro"> · {p.approxDate}</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}

      {error && (
        <div className="why-now-error" role="alert">
          <AlertTriangle size={11} aria-hidden /> {errorCode === 'AI_NOT_CONFIGURED' ? t('whyNow.notConfigured') : error}
        </div>
      )}
    </section>
  );
}
