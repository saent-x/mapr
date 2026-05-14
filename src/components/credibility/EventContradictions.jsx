import React, { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RefreshCcw, Sparkles } from 'lucide-react';
import useSubscriptionStore from '../../stores/subscriptionStore';
import { regenerateEventContradictions } from '../../services/backendService.js';

function categoryLabel(cat) {
  switch (cat) {
    case 'casualties': return 'CASUALTIES';
    case 'identity': return 'IDENTITY';
    case 'sequence': return 'SEQUENCE';
    case 'location': return 'LOCATION';
    case 'date': return 'DATE';
    case 'attribution': return 'ATTRIBUTION';
    default: return 'OTHER';
  }
}

function confidenceColor(c) {
  switch (c) {
    case 'high': return 'var(--sev-red)';
    case 'medium': return 'var(--amber)';
    case 'low': return 'var(--ink-3)';
    default: return 'var(--ink-2)';
  }
}

export default function EventContradictions({ eventId, contradictions = [], generatedAt, sourcesByKey = {} }) {
  const { t } = useTranslation();
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  const [items, setItems] = useState(contradictions);
  const [generatedAtLocal, setGeneratedAtLocal] = useState(generatedAt);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  const [errorCode, setErrorCode] = useState(null);

  const handleRegenerate = useCallback(async () => {
    setBusy(true);
    setError(null);
    setErrorCode(null);
    try {
      const row = await regenerateEventContradictions(eventId);
      setItems(row?.contradictions || []);
      setGeneratedAtLocal(row?.generatedAt || null);
    } catch (err) {
      setError(err.message || 'Failed to extract contradictions');
      setErrorCode(err.code || err.payload?.code || null);
    } finally {
      setBusy(false);
    }
  }, [eventId]);

  const sourceName = (key) => sourcesByKey[key]?.sourceName || key;

  if (!items.length && !generatedAtLocal) {
    if (!isAuthenticated) return null;
    return (
      <div className="contradictions-empty" data-testid="contradictions-empty">
        <div className="mono micro">{t('contradictions.title')}</div>
        <p>{t('contradictions.notRunYet')}</p>
        <button
          type="button"
          className="btn primary"
          onClick={handleRegenerate}
          disabled={busy}
          data-testid="contradictions-generate"
        >
          <Sparkles size={11} aria-hidden /> {busy ? t('contradictions.generating') : t('contradictions.generate')}
        </button>
        {error && (
          <div className="contradictions-error" role="alert">
            <AlertTriangle size={11} aria-hidden /> {errorCode === 'AI_NOT_CONFIGURED' ? t('contradictions.notConfigured') : error}
          </div>
        )}
      </div>
    );
  }

  if (!items.length) {
    return (
      <div className="contradictions-empty mono micro" data-testid="contradictions-none">
        {t('contradictions.none')}
      </div>
    );
  }

  return (
    <section className="contradictions-section" data-testid="contradictions-section">
      <header className="contradictions-head">
        <h3 className="mono">{t('contradictions.title')}</h3>
        {isAuthenticated && (
          <button
            type="button"
            className="alert-rules-toggle"
            onClick={handleRegenerate}
            disabled={busy}
            title={t('contradictions.regenerate')}
            aria-label={t('contradictions.regenerate')}
            data-testid="contradictions-regenerate"
          >
            <RefreshCcw size={10} aria-hidden />
          </button>
        )}
      </header>

      <ul className="contradictions-list">
        {items.map((row, idx) => (
          <li
            key={`${row.category}-${idx}`}
            className="contradiction-card"
            data-testid={`contradiction-card-${idx}`}
          >
            <div className="contradiction-card-head">
              <span className="contradiction-category mono micro">{categoryLabel(row.category)}</span>
              <span
                className="contradiction-confidence mono micro"
                style={{ color: confidenceColor(row.confidence) }}
              >
                {String(row.confidence || 'medium').toUpperCase()} CONF
              </span>
            </div>
            <p className="contradiction-claim">{row.claim}</p>
            <div className="contradiction-buckets">
              {row.supportedBy?.length > 0 && (
                <div className="contradiction-bucket">
                  <span className="mono micro contradiction-bucket-label">{t('contradictions.support')}</span>
                  <span className="contradiction-bucket-sources">
                    {row.supportedBy.map((k) => sourceName(k)).join(', ')}
                  </span>
                </div>
              )}
              {row.refutedBy?.length > 0 && (
                <div className="contradiction-bucket">
                  <span className="mono micro contradiction-bucket-label">{t('contradictions.refute')}</span>
                  <span className="contradiction-bucket-sources">
                    {row.refutedBy.map((k) => sourceName(k)).join(', ')}
                  </span>
                </div>
              )}
              {row.unclear?.length > 0 && (
                <div className="contradiction-bucket">
                  <span className="mono micro contradiction-bucket-label">{t('contradictions.unclear')}</span>
                  <span className="contradiction-bucket-sources">
                    {row.unclear.map((k) => sourceName(k)).join(', ')}
                  </span>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>

      {error && (
        <div className="contradictions-error" role="alert">
          <AlertTriangle size={11} aria-hidden /> {errorCode === 'AI_NOT_CONFIGURED' ? t('contradictions.notConfigured') : error}
        </div>
      )}
    </section>
  );
}
