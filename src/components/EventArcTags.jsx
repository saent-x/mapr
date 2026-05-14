import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { fetchEventArcs } from '../services/backendService.js';

/**
 * Renders the small "Part of: …" line below the event detail pill row.
 * Silently hides itself when the event isn't in any arc.
 */
export default function EventArcTags({ eventId }) {
  const { t } = useTranslation();
  const [arcs, setArcs] = useState([]);

  useEffect(() => {
    if (!eventId) return;
    let cancelled = false;
    fetchEventArcs(eventId)
      .then((res) => { if (!cancelled) setArcs(res?.arcs || []); })
      .catch(() => { /* silent */ });
    return () => { cancelled = true; };
  }, [eventId]);

  if (!arcs.length) return null;

  return (
    <div className="event-arc-tags mono micro" data-testid="event-arc-tags">
      <Layers size={10} aria-hidden /> {t('arcs.partOf')}{' '}
      {arcs.map((a, i) => (
        <React.Fragment key={a.id}>
          <Link to={`/arcs/${encodeURIComponent(a.id)}`} className="event-arc-tag">
            {a.name}
          </Link>
          {i < arcs.length - 1 && ' · '}
        </React.Fragment>
      ))}
    </div>
  );
}
