import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Layers } from 'lucide-react';
import { fetchArcs } from '../services/backendService.js';

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

export default function ArcsPage() {
  const { t } = useTranslation();
  const [arcs, setArcs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchArcs({ limit: 24 })
      .then(({ arcs }) => { if (!cancelled) setArcs(arcs || []); })
      .catch((err) => { if (!cancelled) setError(err.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="arcs-page">
      <header className="arcs-page-head">
        <h1 className="arcs-page-title">
          <Layers size={16} aria-hidden /> {t('arcs.pageTitle')}
        </h1>
        <p className="arcs-page-sub">{t('arcs.pageSubtitle')}</p>
      </header>

      {loading && <div className="mono micro">{t('arcs.loading')}</div>}

      {!loading && error && (
        <div className="arcs-empty" role="alert">{error}</div>
      )}

      {!loading && !error && arcs.length === 0 && (
        <div className="arcs-empty">
          <div className="mono micro">{t('arcs.empty')}</div>
        </div>
      )}

      {arcs.length > 0 && (
        <div className="arcs-grid">
          {arcs.map((arc) => (
            <Link key={arc.id} to={`/arcs/${encodeURIComponent(arc.id)}`} className="arc-card">
              <header className="arc-card-head">
                <span className="arc-card-status" data-status={arc.status}>{String(arc.status).toUpperCase()}</span>
                <span className="mono micro">{arc.eventCount} {t('arcs.events')}</span>
              </header>
              <h2 className="arc-card-name">{arc.name}</h2>
              <p className="arc-card-summary">{arc.summary}</p>
              <footer className="arc-card-foot mono micro">
                {t('arcs.lastUpdate')}: {relative(arc.lastUpdatedAt)}
              </footer>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
