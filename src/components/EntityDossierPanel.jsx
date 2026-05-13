import React, { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BookText, RefreshCcw, Sparkles, AlertTriangle, Quote, Link as LinkIcon } from 'lucide-react';
import useSubscriptionStore from '../stores/subscriptionStore';
import { fetchEntityDossier, regenerateEntityDossier } from '../services/backendService.js';

function relative(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

/**
 * Renders the LLM-compiled dossier for a named entity. Receives the
 * display name + the entity type (person | organization | location).
 * Loads any cached dossier on mount; offers a "Generate" CTA when
 * empty or stale.
 */
export default function EntityDossierPanel({ name, type = 'entity' }) {
  const { t } = useTranslation();
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  useEffect(() => {
    if (!name) return;
    let cancelled = false;
    setLoading(true);
    fetchEntityDossier(name)
      .then((row) => { if (!cancelled) setData(row); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [name]);

  const handleGenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const row = await regenerateEntityDossier(name, { type, force: true });
      setData(row);
    } catch (err) {
      setError(err.message || 'Failed');
      setErrorCode(err.code || err.payload?.code || null);
    } finally {
      setBusy(false);
    }
  }, [name, type]);

  if (!name) return null;

  const hasDossier = Boolean(data?.summary);
  const empty = !hasDossier;

  return (
    <section className="entity-dossier" data-testid="entity-dossier">
      <header className="entity-dossier-head">
        <h3>
          <BookText size={12} aria-hidden /> {name}
        </h3>
        {isAuthenticated && hasDossier && (
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={handleGenerate}
            disabled={busy}
            title={t('dossier.regenerate')}
            aria-label={t('dossier.regenerate')}
          >
            <RefreshCcw size={10} aria-hidden />
          </button>
        )}
      </header>

      {loading && <div className="mono micro">{t('dossier.loading')}</div>}

      {!loading && empty && isAuthenticated && (
        <div className="entity-dossier-empty">
          <p>{t('dossier.notRunYet')}</p>
          <button
            type="button"
            className="btn primary"
            onClick={handleGenerate}
            disabled={busy}
            data-testid="dossier-generate"
          >
            <Sparkles size={11} aria-hidden /> {busy ? t('dossier.generating') : t('dossier.generate')}
          </button>
        </div>
      )}

      {!loading && empty && !isAuthenticated && (
        <div className="entity-dossier-empty mono micro">{t('dossier.signInToGenerate')}</div>
      )}

      {hasDossier && (
        <>
          {data.role && <p className="mono micro entity-dossier-role">{data.role}</p>}
          <p className="entity-dossier-summary">{data.summary}</p>

          {data.recentActivity && (
            <section className="entity-dossier-block">
              <div className="mono micro entity-dossier-subhead">{t('dossier.recentActivity')}</div>
              <p>{data.recentActivity}</p>
            </section>
          )}

          {Array.isArray(data.keyRelationships) && data.keyRelationships.length > 0 && (
            <section className="entity-dossier-block">
              <div className="mono micro entity-dossier-subhead">
                <LinkIcon size={9} aria-hidden /> {t('dossier.relationships')}
              </div>
              <ul className="entity-dossier-rel">
                {data.keyRelationships.map((r, i) => (
                  <li key={`rel-${i}`}>
                    <strong>{r.other}</strong>
                    {r.kind && <span className="mono micro"> · {r.kind}</span>}
                    {r.context && <div className="mono micro">{r.context}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {Array.isArray(data.notableQuotes) && data.notableQuotes.length > 0 && (
            <section className="entity-dossier-block">
              <div className="mono micro entity-dossier-subhead">
                <Quote size={9} aria-hidden /> {t('dossier.quotes')}
              </div>
              <ul className="entity-dossier-quotes">
                {data.notableQuotes.map((q, i) => (
                  <li key={`q-${i}`}>
                    <span>"{q.quote}"</span>
                    {q.context && <div className="mono micro">{q.context}</div>}
                  </li>
                ))}
              </ul>
            </section>
          )}

          <footer className="mono micro entity-dossier-foot">
            {data.articleCount} {t('dossier.articlesScanned')}
            {data.generatedAt && (
              <> · {t('dossier.lastBuilt', { relative: relative(data.generatedAt) })}</>
            )}
          </footer>
        </>
      )}

      {error && (
        <div className="entity-dossier-error" role="alert">
          <AlertTriangle size={11} aria-hidden /> {errorCode === 'AI_NOT_CONFIGURED' ? t('dossier.notConfigured') : error}
        </div>
      )}
    </section>
  );
}
