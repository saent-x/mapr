import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Send, Filter } from 'lucide-react';

export default function AgentComposer({
  onSend,
  disabled = false,
  quotaExceeded = false,
  notConfigured = false,
  useCurrentFilters = false,
  onToggleFilters,
  quota,
}) {
  const { t } = useTranslation();
  const [text, setText] = useState('');
  const textareaRef = useRef(null);

  // Auto-grow textarea up to 6 lines.
  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 6 * 22) + 'px';
  }, [text]);

  const handleSubmit = useCallback(
    (e) => {
      e?.preventDefault?.();
      const trimmed = text.trim();
      if (!trimmed || disabled || quotaExceeded || notConfigured) return;
      onSend(trimmed);
      setText('');
    },
    [text, disabled, quotaExceeded, notConfigured, onSend],
  );

  const handleKeyDown = useCallback(
    (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        handleSubmit();
      }
    },
    [handleSubmit],
  );

  const sendDisabled = disabled || quotaExceeded || notConfigured || !text.trim();

  return (
    <form className="agent-composer" onSubmit={handleSubmit}>
      {quota && !quotaExceeded && (
        <div className="agent-quota mono micro" data-testid="agent-quota">
          {t('agent.quotaUsed', { used: quota.used, limit: quota.limit })}
        </div>
      )}
      {quotaExceeded && (
        <div className="agent-quota agent-quota--exceeded" role="alert" data-testid="agent-quota-exceeded">
          <strong>{t('agent.quotaExceededTitle')}</strong>
          <p>{t('agent.quotaExceededBody', { limit: quota?.limit ?? 10 })}</p>
        </div>
      )}
      {notConfigured && (
        <div className="agent-quota agent-quota--exceeded" role="alert" data-testid="agent-not-configured">
          <strong>{t('agent.errorNotConfiguredTitle')}</strong>
          <p>{t('agent.errorNotConfiguredBody')}</p>
        </div>
      )}

      <div className="agent-composer-row">
        <button
          type="button"
          className="agent-filter-toggle"
          onClick={() => onToggleFilters?.(!useCurrentFilters)}
          data-active={useCurrentFilters ? 'true' : undefined}
          title={t('agent.useCurrentFiltersHelp')}
          aria-pressed={useCurrentFilters}
          aria-label={t('agent.useCurrentFilters')}
        >
          <Filter size={11} aria-hidden />
        </button>
        <textarea
          ref={textareaRef}
          className="agent-composer-input"
          placeholder={t('agent.composerPlaceholder')}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={1}
          disabled={disabled || quotaExceeded || notConfigured}
          data-testid="agent-composer-input"
        />
        <button
          type="submit"
          className="agent-composer-send"
          disabled={sendDisabled}
          aria-label={t('agent.composerSend')}
          data-testid="agent-composer-send"
        >
          <Send size={12} aria-hidden />
        </button>
      </div>
    </form>
  );
}
