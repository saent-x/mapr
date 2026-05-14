import React, { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layers, ArrowLeft, MapPin } from 'lucide-react';
import { fetchArc } from '../services/backendService.js';

function relative(iso) {
  if (!iso) return '';
  const ts = Date.parse(iso);
  if (!Number.isFinite(ts)) return '';
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 60) return `${Math.max(1, m)}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function severityClass(s) {
  if (s >= 85) return 'black';
  if (s >= 70) return 'red';
  if (s >= 40) return 'amber';
  return 'green';
}

export default function ArcDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const [arc, setArc] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetchArc(id)
      .then(({ arc }) => { if (!cancelled) setArc(arc); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [id]);

  return (
    <div className="arc-detail-page">
      <Link to="/arcs" className="arc-detail-back">
        <ArrowLeft size={14} aria-hidden /> {t('arcs.back')}
      </Link>

      {loading && <div className="mono micro">{t('arcs.loading')}</div>}

      {!loading && error && (
        <div className="arcs-empty" role="alert">{error}</div>
      )}

      {!loading && arc && (
        <>
          <header className="arc-detail-head">
            <h1>
              <Layers size={18} aria-hidden /> {arc.name}
            </h1>
            <div className="arc-detail-meta mono micro">
              <span className="arc-card-status" data-status={arc.status}>{String(arc.status).toUpperCase()}</span>
              <span>{arc.eventCount} {t('arcs.events')}</span>
              <span>{t('arcs.firstSeen')}: {relative(arc.firstSeenAt)}</span>
              <span>{t('arcs.lastUpdate')}: {relative(arc.lastUpdatedAt)}</span>
            </div>
            <p className="arc-detail-summary">{arc.summary}</p>
          </header>

          <section className="arc-detail-events">
            <h2 className="mono micro arc-detail-events-head">{t('arcs.eventsHeading')}</h2>
            <ul className="arc-detail-event-list">
              {(arc.events || []).map((ev) => (
                <li key={ev.eventId} className="arc-detail-event">
                  <Link to={`/event/${encodeURIComponent(ev.eventId)}`} className="arc-detail-event-link">
                    <span className={`sev-pill sev-${severityClass(ev.severity || 0)}`}>SEV {Math.round(ev.severity || 0)}</span>
                    <span className="arc-detail-event-title">{ev.title}</span>
                    <span className="mono micro arc-detail-event-meta">
                      {ev.primaryCountry && <><MapPin size={9} aria-hidden /> {ev.primaryCountry}{' · '}</>}
                      {ev.lifecycle && <>{ev.lifecycle}{' · '}</>}
                      {relative(ev.lastUpdatedAt)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
