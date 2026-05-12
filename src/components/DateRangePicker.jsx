import React, { useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Calendar, X } from 'lucide-react';

const PRESETS = [
  { key: '24h', hours: 24, labelNs: 'historicalQueries.presets24h' },
  { key: '7d', hours: 168, labelNs: 'historicalQueries.presets7d' },
  { key: '30d', hours: 720, labelNs: 'historicalQueries.presets30d' },
];

function toDateInputValue(date) {
  if (!date) return '';
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return '';
  return d.toISOString().slice(0, 10);
}

function todayDate() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * DateRangePicker — from/to date inputs with validation and quick presets.
 */
export default function DateRangePicker({ onApply, onCancel, initialFrom, initialTo }) {
  const { t } = useTranslation();

  const [fromDate, setFromDate] = useState(() => initialFrom ? toDateInputValue(initialFrom) : '');
  const [toDate, setToDate] = useState(() => initialTo ? toDateInputValue(initialTo) : '');
  const [error, setError] = useState('');

  const today = todayDate();

  const validate = useCallback(() => {
    if (!fromDate) {
      setError(t('historicalQueries.errorFromRequired'));
      return false;
    }
    if (!toDate) {
      setError(t('historicalQueries.errorToRequired'));
      return false;
    }
    if (fromDate > today) {
      setError(t('historicalQueries.errorFromFuture'));
      return false;
    }
    if (fromDate > toDate) {
      setError(t('historicalQueries.errorFromAfterTo'));
      return false;
    }
    setError('');
    return true;
  }, [fromDate, toDate, today, t]);

  const handleApply = useCallback(() => {
    if (!validate()) return;
    onApply?.({ from: fromDate, to: toDate });
  }, [validate, fromDate, toDate, onApply]);

  const handlePreset = useCallback((preset) => {
    const now = new Date();
    const from = new Date(now.getTime() - preset.hours * 60 * 60 * 1000);
    setFromDate(toDateInputValue(from));
    setToDate(toDateInputValue(now));
    setError('');
  }, []);

  const handleClear = useCallback(() => {
    setFromDate('');
    setToDate('');
    setError('');
    onCancel?.();
  }, [onCancel]);

  return (
    <div className="mapr-date-range-picker">
      <div className="mapr-date-range-header">
        <Calendar size={16} />
        <span>{t('historicalQueries.dateRangeTitle')}</span>
      </div>

      <div className="mapr-date-range-presets">
        {PRESETS.map((preset) => (
          <button
            key={preset.key}
            className="mapr-chip"
            onClick={() => handlePreset(preset)}
            type="button"
          >
            {t(preset.labelNs)}
          </button>
        ))}
      </div>

      <div className="mapr-date-range-inputs">
        <label className="mapr-date-label">
          <span>{t('historicalQueries.fromLabel')}</span>
          <input
            type="date"
            className="mapr-date-input"
            value={fromDate}
            max={today}
            onChange={(e) => { setFromDate(e.target.value); setError(''); }}
          />
        </label>
        <span className="mapr-date-separator">—</span>
        <label className="mapr-date-label">
          <span>{t('historicalQueries.toLabel')}</span>
          <input
            type="date"
            className="mapr-date-input"
            value={toDate}
            max={today}
            onChange={(e) => { setToDate(e.target.value); setError(''); }}
          />
        </label>
      </div>

      {error && <p className="mapr-date-error">{error}</p>}

      <div className="mapr-date-range-actions">
        <button className="mapr-btn mapr-btn-secondary" onClick={handleClear} type="button">
          <X size={14} />
          {t('historicalQueries.cancel')}
        </button>
        <button className="mapr-btn mapr-btn-primary" onClick={handleApply} type="button">
          {t('historicalQueries.apply')}
        </button>
      </div>

      <style>{`
        .mapr-date-range-picker {
          padding: 12px;
          background: var(--bg-1);
          border: 1px solid var(--border);
          border-radius: 8px;
        }
        .mapr-date-range-header {
          display: flex;
          align-items: center;
          gap: 8px;
          font-size: 0.8125rem;
          font-weight: 600;
          color: var(--text-0);
          margin-bottom: 10px;
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .mapr-date-range-presets {
          display: flex;
          gap: 6px;
          margin-bottom: 10px;
          flex-wrap: wrap;
        }
        .mapr-chip {
          padding: 4px 10px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-2);
          color: var(--text-1);
          font-size: 0.75rem;
          cursor: pointer;
          transition: all 0.15s;
          font-family: var(--ff-mono);
        }
        .mapr-chip:hover {
          border-color: var(--amber);
          color: var(--amber);
        }
        .mapr-date-range-inputs {
          display: flex;
          align-items: flex-end;
          gap: 8px;
          margin-bottom: 8px;
        }
        .mapr-date-label {
          display: flex;
          flex-direction: column;
          gap: 4px;
          flex: 1;
        }
        .mapr-date-label span {
          font-size: 0.6875rem;
          color: var(--text-2);
          text-transform: uppercase;
          letter-spacing: 0.05em;
        }
        .mapr-date-input {
          padding: 6px 8px;
          border: 1px solid var(--border);
          border-radius: 4px;
          background: var(--bg-2);
          color: var(--text-0);
          font-size: 0.8125rem;
          font-family: var(--ff-mono);
          width: 100%;
        }
        .mapr-date-input:focus {
          outline: none;
          border-color: var(--amber);
        }
        .mapr-date-separator {
          color: var(--text-2);
          font-size: 0.8125rem;
          padding-bottom: 6px;
        }
        .mapr-date-error {
          color: var(--sev-red);
          font-size: 0.75rem;
          margin: 4px 0;
        }
        .mapr-date-range-actions {
          display: flex;
          gap: 8px;
          justify-content: flex-end;
          margin-top: 10px;
        }
        .mapr-btn {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          padding: 5px 12px;
          border-radius: 4px;
          font-size: 0.75rem;
          font-weight: 600;
          cursor: pointer;
          border: none;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .mapr-btn-primary {
          background: var(--amber);
          color: var(--bg-0);
        }
        .mapr-btn-primary:hover {
          opacity: 0.9;
        }
        .mapr-btn-secondary {
          background: transparent;
          color: var(--text-2);
          border: 1px solid var(--border);
        }
        .mapr-btn-secondary:hover {
          color: var(--text-0);
          border-color: var(--text-2);
        }
      `}</style>
    </div>
  );
}
