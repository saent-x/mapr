import React, { useState } from 'react';
import { X, ChevronDown } from 'lucide-react';

const LIFECYCLE_COLORS = {
  emerging: '#00d4ff',
  developing: '#00e5a0',
  escalating: '#ff5555',
  stabilizing: '#ffaa00',
  resolved: '#666',
};

function LifecycleBadge({ lifecycle }) {
  if (!lifecycle) return null;
  return (
    <span
      className="lifecycle-badge"
      style={{
        color: LIFECYCLE_COLORS[lifecycle] || '#666',
        borderColor: LIFECYCLE_COLORS[lifecycle] || '#666',
      }}
    >
      {lifecycle}
    </span>
  );
}

function buildSummaryLine({ newEvents, escalated, resolved, lifecycleChanges }) {
  const parts = [];
  if (newEvents.length > 0) parts.push(`${newEvents.length} new event${newEvents.length !== 1 ? 's' : ''}`);
  if (escalated.length > 0) parts.push(`${escalated.length} escalated`);
  if (resolved.length > 0) parts.push(`${resolved.length} resolved`);
  if (lifecycleChanges.length > 0) parts.push(`${lifecycleChanges.length} lifecycle change${lifecycleChanges.length !== 1 ? 's' : ''}`);
  return parts.join(', ');
}

const ChangesBanner = ({ diff, onDismiss }) => {
  const [expanded, setExpanded] = useState(false);

  if (!diff || diff.isFirstVisit) return null;

  const { newEvents = [], escalated = [], resolved = [], lifecycleChanges = [] } = diff;
  const hasChanges = newEvents.length > 0 || escalated.length > 0 || resolved.length > 0 || lifecycleChanges.length > 0;
  const summaryLine = hasChanges ? buildSummaryLine(diff) + ' since last visit' : null;

  return (
    <div className="changes-banner">
      <div className="changes-banner-header">
        <button
          className="changes-banner-summary-btn"
          onClick={() => hasChanges && setExpanded((v) => !v)}
          disabled={!hasChanges}
          aria-expanded={expanded}
        >
          {hasChanges ? (
            <>
              <span className="changes-banner-summary-text">{summaryLine}</span>
              <ChevronDown
                size={11}
                className={`changes-banner-chevron${expanded ? ' is-open' : ''}`}
              />
            </>
          ) : (
            <span className="changes-banner-muted">No changes since last visit</span>
          )}
        </button>
        <button
          className="changes-banner-dismiss"
          onClick={onDismiss}
          aria-label="Dismiss"
        >
          <X size={11} />
        </button>
      </div>

      {expanded && hasChanges && (
        <div className="changes-banner-body">
          {newEvents.length > 0 && (
            <div className="changes-banner-section">
              <div className="changes-banner-section-label">New Events</div>
              {newEvents.map((event) => (
                <div key={event.id} className="changes-banner-item">
                  <span className="changes-banner-dot is-new" />
                  <span className="changes-banner-item-title">{event.title}</span>
                  <LifecycleBadge lifecycle={event.lifecycle} />
                </div>
              ))}
            </div>
          )}

          {escalated.length > 0 && (
            <div className="changes-banner-section">
              <div className="changes-banner-section-label">Escalated</div>
              {escalated.map((event) => (
                <div key={event.id} className="changes-banner-item">
                  <span className="changes-banner-dot is-escalated" />
                  <span className="changes-banner-item-title">{event.title}</span>
                  <LifecycleBadge lifecycle={event.lifecycle} />
                </div>
              ))}
            </div>
          )}

          {resolved.length > 0 && (
            <div className="changes-banner-section">
              <div className="changes-banner-section-label">Resolved</div>
              {resolved.map((event) => (
                <div key={event.id} className="changes-banner-item">
                  <span className="changes-banner-dot is-resolved" />
                  <span className="changes-banner-item-title">{event.title}</span>
                  <LifecycleBadge lifecycle={event.lifecycle} />
                </div>
              ))}
            </div>
          )}

          {lifecycleChanges.length > 0 && (
            <div className="changes-banner-section">
              <div className="changes-banner-section-label">Lifecycle Changes</div>
              {lifecycleChanges.map((event) => (
                <div key={event.id} className="changes-banner-item">
                  <span className="changes-banner-dot is-lifecycle" />
                  <span className="changes-banner-item-title">{event.title}</span>
                  <LifecycleBadge lifecycle={event.lifecycle} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ChangesBanner;
