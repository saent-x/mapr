import React, { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AgentCitation from './AgentCitation.jsx';

const CITATION_TOKEN_RE = /\[(\d{1,2})\]/g;

/**
 * Splits an assistant message body into text + inline citation pills.
 * The model is instructed to emit `[1]`, `[2]`, … markers; we replace
 * each marker with an AgentCitation pill linked to the matching entry.
 */
function renderContentWithCitations(content, citations) {
  if (!content) return null;
  const map = new Map((citations || []).map((c) => [Number(c.index), c]));
  const parts = [];
  let lastIdx = 0;
  let match;
  CITATION_TOKEN_RE.lastIndex = 0;
  while ((match = CITATION_TOKEN_RE.exec(content)) != null) {
    const idx = Number(match[1]);
    if (match.index > lastIdx) {
      parts.push(content.slice(lastIdx, match.index));
    }
    const cite = map.get(idx);
    if (cite) {
      parts.push(<AgentCitation key={`c-${match.index}-${idx}`} citation={cite} />);
    } else {
      parts.push(match[0]);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < content.length) parts.push(content.slice(lastIdx));
  return parts;
}

export default function AgentMessageList({ messages = [], status, error }) {
  const { t } = useTranslation();
  const scrollerRef = useRef(null);
  const isSending = status === 'sending';
  const showEmpty = !messages.length && status !== 'sending';

  // Auto-scroll to bottom on new messages or while sending.
  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length, isSending]);

  const sortedCitations = useMemo(() => {
    // Used to render the trailing "Sources" footnote — last assistant
    // message wins.
    const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
    return lastAssistant?.citations || [];
  }, [messages]);

  return (
    <div className="agent-message-list" ref={scrollerRef} aria-live="polite" aria-busy={isSending}>
      {showEmpty && (
        <div className="agent-message-empty" data-testid="agent-empty">
          {t('agent.emptyStateSignedIn')}
        </div>
      )}
      {messages.map((m) => (
        <div
          key={m.id}
          className={`agent-message agent-message--${m.role}${m.optimistic ? ' agent-message--optimistic' : ''}`}
          data-testid={`agent-message-${m.role}`}
        >
          {m.role === 'assistant'
            ? <div className="agent-message-body">{renderContentWithCitations(m.content, m.citations)}</div>
            : <div className="agent-message-body">{m.content}</div>}
          {m.role === 'assistant' && m.modelUsed && (
            <div className="agent-message-meta mono">
              {t('agent.modelLabel')}: {m.modelUsed}
            </div>
          )}
        </div>
      ))}
      {isSending && (
        <div className="agent-message agent-message--assistant agent-message--pending" data-testid="agent-thinking">
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span className="agent-thinking-dot" />
          <span className="mono micro" style={{ marginLeft: 8 }}>{t('agent.thinking')}</span>
        </div>
      )}
      {sortedCitations.length > 0 && (
        <div className="agent-sources mono micro" data-testid="agent-sources">
          <div>{t('agent.footnoteSources')}</div>
          <ol>
            {sortedCitations.map((c) => (
              <li key={`src-${c.index}`} value={c.index}>
                <AgentCitation citation={c} />
                <span className="agent-source-title">{c.title}</span>
                {c.source && <span className="agent-source-outlet"> · {c.source}</span>}
              </li>
            ))}
          </ol>
        </div>
      )}
      {error && status === 'error' && (
        <div className="agent-error" role="alert">
          <strong>{t('agent.errorGenericTitle')}</strong>
          <div>{t('agent.errorGenericBody')}</div>
        </div>
      )}
    </div>
  );
}
