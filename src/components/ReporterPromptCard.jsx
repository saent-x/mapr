import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { HelpCircle, RefreshCcw, Users, AlertTriangle, Sparkles } from 'lucide-react';
import useSubscriptionStore from '../stores/subscriptionStore';
import { fetchReporterPrompt, regenerateReporterPrompt } from '../services/backendService.js';

export default function ReporterPromptCard({ event }) {
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
    fetchReporterPrompt(event.id)
      .then((row) => { if (!cancelled) setData(row); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [event?.id]);

  const handleGenerate = useCallback(async () => {
    if (!event?.id) return;
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const row = await regenerateReporterPrompt(event.id, { force: true });
      setData(row);
    } catch (err) {
      setError(err.message || 'Failed');
      setErrorCode(err.code || err.payload?.code || null);
    } finally {
      setBusy(false);
    }
  }, [event?.id]);

  if (!event?.id) return null;

  const empty = !loading && !data?.questions?.length && !data?.reporters?.length;

  return (
    <section className="event-detail-section reporter-prompt-section" data-testid="reporter-prompt">
      <header className="event-detail-section-head">
        <h2 className="event-detail-section-title">
          <HelpCircle size={12} aria-hidden /> {t('reporterPrompt.title')}
        </h2>
        {(isAuthenticated && data?.questions?.length > 0) && (
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={handleGenerate}
            disabled={busy}
            title={t('reporterPrompt.regenerate')}
            aria-label={t('reporterPrompt.regenerate')}
          >
            <RefreshCcw size={10} aria-hidden />
          </button>
        )}
      </header>

      {loading && <div className="mono micro reporter-prompt-loading">{t('reporterPrompt.loading')}</div>}

      {empty && isAuthenticated && (
        <div className="reporter-prompt-empty">
          <p>{t('reporterPrompt.notRunYet')}</p>
          <button
            type="button"
            className="btn primary"
            onClick={handleGenerate}
            disabled={busy}
            data-testid="reporter-prompt-generate"
          >
            <Sparkles size={11} aria-hidden /> {busy ? t('reporterPrompt.generating') : t('reporterPrompt.generate')}
          </button>
        </div>
      )}

      {empty && !isAuthenticated && (
        <div className="reporter-prompt-empty mono micro">{t('reporterPrompt.signInToGenerate')}</div>
      )}

      {data?.questions?.length > 0 && (
        <div className="reporter-prompt-block">
          <div className="mono micro reporter-prompt-subhead">{t('reporterPrompt.unansweredHeading')}</div>
          <ol className="reporter-prompt-questions">
            {data.questions.map((q, i) => (
              <li key={`q-${i}`}>
                <strong>{q.question}</strong>
                {q.why && <div className="mono micro">{q.why}</div>}
              </li>
            ))}
          </ol>
        </div>
      )}

      {data?.reporters?.length > 0 && (
        <div className="reporter-prompt-block">
          <div className="mono micro reporter-prompt-subhead">
            <Users size={9} aria-hidden /> {t('reporterPrompt.reportersHeading')}
          </div>
          <ul className="reporter-prompt-reporters">
            {data.reporters.map((r, i) => (
              <li key={`r-${i}`}>
                <strong>{r.name}</strong>
                {r.outlet && <span className="mono micro"> · {r.outlet}</span>}
                {r.beat && <div className="mono micro">{r.beat}</div>}
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && (
        <div className="reporter-prompt-error" role="alert">
          <AlertTriangle size={11} aria-hidden /> {errorCode === 'AI_NOT_CONFIGURED' ? t('reporterPrompt.notConfigured') : error}
        </div>
      )}
    </section>
  );
}
