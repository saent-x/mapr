import React from 'react';
import { cn } from '../../lib/utils.ts';

function renderInlineContent(content, citationMap, keyPrefix, renderCitation) {
  const parts = [];
  let lastIdx = 0;
  let match;
  const tokenRe = /(\[(\d{1,2})\]|\*\*([^*]+)\*\*|`([^`]+)`)/g;
  while ((match = tokenRe.exec(content)) != null) {
    if (match.index > lastIdx) parts.push(content.slice(lastIdx, match.index));
    if (match[2]) {
      const idx = Number(match[2]);
      const cite = citationMap.get(idx);
      parts.push(cite ? renderCitation(cite, `${keyPrefix}-c-${match.index}-${idx}`) : match[0]);
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

export function Response({
  className,
  content,
  citations = [],
  renderCitation,
}) {
  const text = String(content || '').trim();
  if (!text) return null;

  const citationMap = new Map(citations.map((c) => [Number(c.index), c]));
  const lines = text.split(/\r?\n/);
  const blocks = [];
  const paragraph = [];
  const cite = renderCitation || ((citation, key) => <sup key={key}>[{citation.index}]</sup>);

  const flushParagraph = () => {
    if (!paragraph.length) return;
    const body = paragraph.join(' ').trim();
    if (body) {
      blocks.push(
        <p key={`p-${blocks.length}`}>
          {renderInlineContent(body, citationMap, `p-${blocks.length}`, cite)}
        </p>,
      );
    }
    paragraph.length = 0;
  };

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      flushParagraph();
      continue;
    }

    const heading = /^(#{1,4})\s+(.+)$/.exec(trimmed);
    if (heading) {
      flushParagraph();
      blocks.push(
        <h4 key={`h-${blocks.length}`}>
          {renderInlineContent(heading[2], citationMap, `h-${blocks.length}`, cite)}
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
              {renderInlineContent(item, citationMap, `ul-${blocks.length}-${idx}`, cite)}
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
              {renderInlineContent(item, citationMap, `ol-${blocks.length}-${idx}`, cite)}
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

  return <div className={cn('prompt-kit-response', className)}>{blocks}</div>;
}
