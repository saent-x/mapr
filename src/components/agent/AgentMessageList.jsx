import React, { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import AgentCitation from './AgentCitation.jsx';

/**
 * Splits inline markdown-ish content into text + citation/bold/code spans.
 * React escapes all text nodes; this deliberately avoids raw HTML.
 */
function renderInlineContent(content, citationMap, keyPrefix) {
  const parts = [];
  let lastIdx = 0;
  let match;
  const tokenRe = /(\[(\d{1,2})\]|\*\*([^*]+)\*\*|`([^`]+)`)/g;
  while ((match = tokenRe.exec(content)) != null) {
    if (match.index > lastIdx) {
      parts.push(content.slice(lastIdx, match.index));
    }
    if (match[2]) {
      const idx = Number(match[2]);
      const cite = citationMap.get(idx);
      parts.push(cite
        ? <AgentCitation key={`${keyPrefix}-c-${match.index}-${idx}`} citation={cite} />
        : match[0]);
    } else if (match[3]) {
      parts.push(<strong key={`${keyPrefix}-b-${match.index}`}>{match[3]}</strong>);
    } else if (match[4]) {
      parts.push(<code key={`${keyPrefix}-code-${match.index}`}>{match[4]}</code>);
    } else {
      parts.push(match[0]);
    }
    lastIdx = match.index + match[0].length;
  }
  if (lastIdx < content.length) parts.push(content.slice(lastIdx));
  return parts;
}

function renderFormattedAssistantContent(content, citations) {
  const text = String(content || '').trim();
  if (!text) return null;

  const citationMap = new Map((citations || []).map((c) => [Number(c.index), c]));
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const paragraph = [];

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const body = paragraph.join(' ').trim();
    if (body) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          {renderInlineContent(body, citationMap, `p-${blocks.length}`)}
        </p>,
      );
    }
    paragraph.length = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push(
        <h4 key={`h-${blocks.length}`}>
          {renderInlineContent(heading[2], citationMap, `h-${blocks.length}`)}
        </h4>,
      );
      continue;
    }

    const bullet = /^[-*]\s+(.+)$/.exec(trimmed);
    if (bullet) {
      flushParagraph();
      const items = [];
      let j = i;
      while (j < lines.length) {
        const item = /^[-*]\s+(.+)$/.exec(lines[j].trim());
        if (!item) break;
        items.push(item[1]);
        j += 1;
      }
      blocks.push(
        <ul key={`ul-${blocks.length}`}>
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>
              {renderInlineContent(item, citationMap, `ul-${blocks.length}-${idx}`)}
            </li>
          ))}
        </ul>,
      );
      i = j - 1;
      continue;
    }

    const numbered = /^\d+\.\s+(.+)$/.exec(trimmed);
    if (numbered) {
      flushParagraph();
      const items = [];
      let j = i;
      while (j < lines.length) {
        const item = /^\d+\.\s+(.+)$/.exec(lines[j].trim());
        if (!item) break;
        items.push(item[1]);
        j += 1;
      }
      blocks.push(
        <ol key={`ol-${blocks.length}`}>
          {items.map((item, idx) => (
            <li key={`li-${idx}`}>
              {renderInlineContent(item, citationMap, `ol-${blocks.length}-${idx}`)}
            </li>
          ))}
        </ol>,
      );
      i = j - 1;
      continue;
    }

    paragraph.push(trimmed);
  }
  flushParagraph();

  return blocks.length
    ? blocks
    : <p>{renderInlineContent(text, citationMap, 'p-empty')}</p>;
}

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
            <span className="agent-source-title">{c.title}</span>
            {c.source && <span className="agent-source-outlet"> · {c.source}</span>}
          </li>
        ))}
      </ol>
    </div>
  );
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
            ? (
                <div className="agent-message-body">
                  {renderFormattedAssistantContent(m.content, m.citations)}
                  <MessageSources citations={m.citations || []} />
                </div>
              )
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
      {error && status === 'error' && (
        <div className="agent-error" role="alert">
          <strong>{t('agent.errorGenericTitle')}</strong>
          <div>{t('agent.errorGenericBody')}</div>
        </div>
      )}
    </div>
  );
}
