import React from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';

/**
 * Renders a single inline citation pill (e.g. <sup>[1]</sup>). When the
 * cited article belongs to an event, the pill navigates to the event
 * detail page; otherwise it opens the article's external URL in a new tab.
 */
export default function AgentCitation({ citation }) {
  const { t } = useTranslation();
  if (!citation) return null;
  const { index, eventId, url, title, source } = citation;
  const tooltip = `[${index}] ${title || ''}${source ? ` · ${source}` : ''}`;

  if (eventId) {
    return (
      <Link
        to={`/event/${encodeURIComponent(eventId)}`}
        className="agent-citation"
        title={tooltip}
        aria-label={t('agent.citationTooltipHasEvent')}
        data-testid={`agent-citation-${index}`}
      >
        <sup>[{index}]</sup>
      </Link>
    );
  }
  if (url) {
    return (
      <a
        href={url}
        className="agent-citation"
        target="_blank"
        rel="noreferrer noopener"
        title={tooltip}
        aria-label={t('agent.citationTooltipExternal')}
        data-testid={`agent-citation-${index}`}
      >
        <sup>[{index}]</sup>
      </a>
    );
  }
  return <sup className="agent-citation agent-citation--inert" title={tooltip}>[{index}]</sup>;
}
