import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AgentCitation from './AgentCitation.jsx';
import {
  Message,
  MessageAvatar,
  MessageContent,
} from '../prompt-kit/message.jsx';
import {
  Reasoning,
  ReasoningContent,
  ReasoningTrigger,
} from '../prompt-kit/reasoning.jsx';
import { SourceContent } from '../prompt-kit/source.jsx';
import { Loader } from '../prompt-kit/loader.jsx';
import { Response } from '../prompt-kit/response.jsx';

function MessageSources({ citations = [] }) {
  const { t } = useTranslation();
  if (!citations.length) return null;
  return (
    <div className="agent-message-sources mono micro" data-testid="agent-message-sources">
      <div>{t('agent.footnoteSources')}</div>
      <ol>
        {citations.map((c) => (
          <li key={`src-${c.index}`} value={c.index}>
            <AgentCitation citation={c} />
            <SourceContent
              className="agent-source-content"
              title={c.title}
              description={c.source || ''}
            />
          </li>
        ))}
      </ol>
    </div>
  );
}

function normalizeReasoning(reasoning) {
  if (!reasoning) return null;
  if (typeof reasoning === 'string') {
    return { notes: [reasoning], sourceCount: null, searchTerms: [], retrievalModes: [], scope: null };
  }
  if (typeof reasoning !== 'object') return null;
  return {
    searchQuery: reasoning.searchQuery || '',
    searchTerms: Array.isArray(reasoning.searchTerms) ? reasoning.searchTerms : [],
    sourceCount: Number.isFinite(Number(reasoning.sourceCount)) ? Number(reasoning.sourceCount) : null,
    retrievalModes: Array.isArray(reasoning.retrievalModes) ? reasoning.retrievalModes : [],
    scope: reasoning.scope && typeof reasoning.scope === 'object' ? reasoning.scope : null,
    notes: Array.isArray(reasoning.notes) ? reasoning.notes : [],
  };
}

function AgentReasoning({ reasoning }) {
  const { t } = useTranslation();
  const trace = normalizeReasoning(reasoning);
  if (!trace) return null;
  const scopeParts = [];
  if (trace.scope?.region) scopeParts.push(trace.scope.region);
  if (trace.scope?.timeWindowHours) scopeParts.push(`${trace.scope.timeWindowHours}h`);

  return (
    <Reasoning className="agent-reasoning" data-testid="agent-reasoning">
      <ReasoningTrigger className="agent-reasoning-trigger">
        {t('agent.reasoningTitle')}
      </ReasoningTrigger>
      <ReasoningContent className="agent-reasoning-content">
        <div className="agent-reasoning-grid">
          {trace.searchQuery && (
            <div>
              <span>{t('agent.reasoningQuery')}</span>
              <code>{trace.searchQuery}</code>
            </div>
          )}
          {trace.sourceCount != null && (
            <div>
              <span>{t('agent.reasoningSources')}</span>
              <strong>{trace.sourceCount}</strong>
            </div>
          )}
          {trace.searchTerms.length > 0 && (
            <div>
              <span>{t('agent.reasoningTerms')}</span>
              <strong>{trace.searchTerms.join(', ')}</strong>
            </div>
          )}
          {trace.retrievalModes.length > 0 && (
            <div>
              <span>{t('agent.reasoningModes')}</span>
              <strong>{trace.retrievalModes.join(', ')}</strong>
            </div>
          )}
          {scopeParts.length > 0 && (
            <div>
              <span>{t('agent.reasoningScope')}</span>
              <strong>{scopeParts.join(' / ')}</strong>
            </div>
          )}
        </div>
        {trace.notes.length > 0 && (
          <ul className="agent-reasoning-notes">
            {trace.notes.map((note, idx) => <li key={`${idx}-${note}`}>{note}</li>)}
          </ul>
        )}
      </ReasoningContent>
    </Reasoning>
  );
}

function formatAgentError(error, t) {
  const code = error?.payload?.code || error?.code || null;
  const message = error?.payload?.error || error?.message || t('agent.errorGenericBody');
  return code ? `${code}: ${message}` : message;
}

function AssistantMessage({ message, reasoning = message.reasoning }) {
  const { t } = useTranslation();
  return (
    <Message
      className="agent-message agent-message--assistant"
      data-testid="agent-message-assistant"
    >
      <MessageAvatar fallback="AI" />
      <MessageContent className="agent-message-body">
        <Response
          content={message.content}
          citations={message.citations || []}
          renderCitation={(citation, key) => <AgentCitation key={key} citation={citation} />}
        />
        <AgentReasoning reasoning={reasoning} />
        <MessageSources citations={message.citations || []} />
        {message.modelUsed && (
          <div className="agent-message-meta mono">
            {t('agent.modelLabel')}: {message.modelUsed}
          </div>
        )}
      </MessageContent>
    </Message>
  );
}

export default function AgentMessageList({ messages = [], status, error }) {
  const { t } = useTranslation();
  const scrollerRef = useRef(null);
  const isSending = status === 'sending';
  const showEmpty = !messages.length && status !== 'sending';

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isSending]);

  return (
    <div className="agent-message-list" ref={scrollerRef} aria-live="polite" aria-busy={isSending}>
      {showEmpty && (
        <div className="agent-message-empty" data-testid="agent-empty">
          {t('agent.emptyStateSignedIn')}
        </div>
      )}
      {messages.map((m) => (
        m.role === 'assistant'
          ? <AssistantMessage key={m.id} message={m} reasoning={m.reasoning} />
          : (
              <Message
                key={m.id}
                className={`agent-message agent-message--user${m.optimistic ? ' agent-message--optimistic' : ''}`}
                data-testid="agent-message-user"
              >
                <MessageContent className="agent-message-body">{m.content}</MessageContent>
              </Message>
            )
      ))}
      {isSending && (
        <Message
          className="agent-message agent-message--assistant agent-message--pending"
          data-testid="agent-thinking"
        >
          <MessageAvatar fallback="AI" />
          <Loader label={t('agent.thinking')} />
        </Message>
      )}
      {error && status === 'error' && (
        <div className="agent-error" role="alert">
          <strong>{t('agent.errorGenericTitle')}</strong>
          <div>{formatAgentError(error, t)}</div>
        </div>
      )}
    </div>
  );
}
