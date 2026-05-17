import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Filter, Search, SendHorizontal } from 'lucide-react';
import {
  PromptInput,
  PromptInputAction,
  PromptInputActions,
  PromptInputTextarea,
} from '../prompt-kit/prompt-input.jsx';

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
      if (e.key === 'Enter' && !e.shiftKey) {
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

      <PromptInput className="agent-composer-shell" isLoading={disabled} data-busy={disabled ? 'true' : undefined}>
        <PromptInputTextarea
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
        <PromptInputActions className="agent-composer-toolbar">
          <PromptInputAction tooltip={t('agent.useCurrentFiltersHelp')}>
            <button
              type="button"
              className="agent-filter-toggle"
              onClick={() => onToggleFilters?.(!useCurrentFilters)}
              data-active={useCurrentFilters ? 'true' : undefined}
              aria-pressed={useCurrentFilters}
              aria-label={t('agent.useCurrentFilters')}
            >
              <Filter size={12} aria-hidden />
              <span>{useCurrentFilters ? t('agent.filtersOn') : t('agent.filtersOff')}</span>
            </button>
          </PromptInputAction>
          <div className="agent-composer-context" aria-live="polite">
            <Search size={12} aria-hidden />
            <span>{useCurrentFilters ? t('agent.contextFiltered') : t('agent.contextCorpus')}</span>
          </div>
          <span className="agent-composer-shortcut mono micro">{t('agent.enterToSend')}</span>
          <PromptInputAction tooltip={t('agent.composerSend')}>
            <button
              type="submit"
              className="agent-composer-send"
              disabled={sendDisabled}
              aria-label={t('agent.composerSend')}
              data-testid="agent-composer-send"
            >
              <SendHorizontal size={14} aria-hidden />
            </button>
          </PromptInputAction>
        </PromptInputActions>
      </PromptInput>
    </form>
  );
}
