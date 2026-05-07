import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, MapPin } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import { getRelatedEvents } from '../utils/entityGraph';
import { getSourceHost } from '../utils/urlUtils';
import { getReliabilityTier, getReliabilityMeta, getReliabilityLabel } from '../utils/credibilityMeta';
import MapLoadingFallback from '../components/MapLoadingFallback';
import { ArticleDetail } from '../components/NewsPanel';

const FlatMap = lazy(() => import('../components/FlatMap'));

function formatTs(ts) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
}

function sevTier(sev) {
  const v = sev ?? 0;
  if (v >= 85) return 'black';
  if (v >= 70) return 'red';
  if (v >= 40) return 'amber';
  return 'green';
}

function lifecycleMeta(lifecycle) {
  if (!lifecycle) return null;
  const map = {
    emerging:    { label: 'EMERGING',    color: 'var(--cyan)' },
    developing:  { label: 'DEVELOPING',  color: 'var(--amber)' },
    escalating:  { label: 'ESCALATING',  color: 'var(--sev-red)' },
    stabilizing: { label: 'STABILIZING', color: 'var(--sev-green)' },
    resolved:    { label: 'RESOLVED',    color: 'var(--ink-2)' },
  };
  return map[lifecycle] || null;
}

function verificationMeta(status) {
  switch (status) {
    case 'verified':
      return { label: 'VERIFIED', color: 'var(--sev-green)' };
    case 'official':
      return { label: 'OFFICIAL', color: 'var(--cyan)' };
    case 'corroborated':
      return { label: 'CORROBORATED', color: 'var(--sev-green)' };
    case 'single-source':
      return { label: 'SINGLE SOURCE', color: 'var(--sev-amber)' };
    case 'amplified':
      return { label: 'AMPLIFIED', color: 'var(--sev-amber)' };
    default:
      return null;
  }
}

/**
 * /event/:id — dedicated event detail page with full metadata,
 * source links, entity list, map location, and related events.
 */
export default function EventDetailPage() {
  const { id } = useParams();
  const { t } = useTranslation();
  const navigate = useNavigate();

  const liveNews = useNewsStore((s) => s.liveNews);
  const backendEvents = useNewsStore((s) => s.backendEvents);

  // Find the event by ID across both liveNews and backendEvents
  const event = useMemo(() => {
    const allEvents = [...(backendEvents || []), ...(liveNews || [])];
    return allEvents.find((ev) => ev.id === id) || null;
  }, [id, liveNews, backendEvents]);

  const allEvents = useMemo(() => {
    if (backendEvents && backendEvents.length > 0) return backendEvents;
    return liveNews || [];
  }, [backendEvents, liveNews]);

  // Related events — events that share entities with this event.
  // Iterate all entity names (people, organizations, locations), call
  // getRelatedEvents per name, flatten, deduplicate by id, filter out self.
  const relatedEvents = useMemo(() => {
    if (!event || !event.entities) return [];
    const entities = event.entities;
    const entityNames = [
      ...((entities.people || []).map((p) => (typeof p === 'string' ? p : p.name || ''))),
      ...((entities.organizations || []).map((o) => (typeof o === 'string' ? o : o.name || ''))),
      ...((entities.locations || []).map((l) => (typeof l === 'string' ? l : l.name || ''))),
    ].filter(Boolean);

    const seen = new Set();
    seen.add(event.id);
    const results = [];
    for (const name of entityNames) {
      const related = getRelatedEvents(allEvents, name, null);
      for (const rel of related) {
        if (!seen.has(rel.id)) {
          seen.add(rel.id);
          results.push(rel);
        }
      }
    }
    return results.slice(0, 8);
  }, [event, allEvents]);

  // Back button handler
  const handleBack = () => {
    navigate(-1);
  };

  // Not found state
  if (!event) {
    return (
      <div className="event-detail-page">
        <div className="event-detail-not-found">
          <div className="micro" style={{ marginBottom: 12 }}>
            {t('eventDetail.notFound', 'EVENT NOT FOUND')}
          </div>
          <p style={{ color: 'var(--ink-2)', fontSize: 13, marginBottom: 16 }}>
            {t('eventDetail.notFoundHint', 'The event you are looking for may have been removed or the ID is invalid.')}
          </p>
          <Link to="/" className="btn primary">
            <ArrowLeft size={14} aria-hidden style={{ marginRight: 6 }} />
            {t('eventDetail.backToMap', 'Back to Map')}
          </Link>
        </div>
      </div>
    );
  }

  const tier = sevTier(event.severity);
  const sev = ((event.severity ?? 0) / 10).toFixed(1);
  const host = getSourceHost(event.url) || event.source || '';
  const vMeta = verificationMeta(event.verificationStatus);
  const lMeta = lifecycleMeta(event.lifecycle);
  const confidence = typeof event.confidence === 'number' ? event.confidence : null;
  const supporting = Array.isArray(event.supportingArticles)
    ? event.supportingArticles.filter((a) => a && a.url && a.url !== event.url).slice(0, 8)
    : [];
  const orgs = event.entities?.organizations?.slice(0, 10) || [];
  const people = event.entities?.people?.slice(0, 10) || [];
  const locations = event.entities?.locations?.slice(0, 10) || [];
  const hasCoords = Array.isArray(event.coordinates) && event.coordinates.length >= 2;

  return (
    <div className="event-detail-page">
      {/* Back button */}
      <button
        type="button"
        className="event-detail-back"
        onClick={handleBack}
        aria-label={t('eventDetail.back', 'Back')}
      >
        <ArrowLeft size={16} aria-hidden />
        <span>{t('eventDetail.back', 'Back')}</span>
      </button>

      {/* Map section */}
      {hasCoords && (
        <div className="event-detail-map">
          <Suspense fallback={<MapLoadingFallback />}>
            <FlatMap
              newsList={[event]}
              regionSeverities={{}}
              mapOverlay="severity"
              coverageStatusByIso={{}}
              perCountryReliability={{}}
              velocitySpikes={[]}
              trackingPoints={[]}
              selectedRegion={null}
              selectedStory={null}
              onRegionSelect={() => {}}
              onStorySelect={() => {}}
              onArcSelect={() => {}}
              onCoverageCountryClick={() => {}}
            />
          </Suspense>
        </div>
      )}

      <div className="event-detail-layout">
        {/* Left column — main content */}
        <div className="event-detail-main">
          {/* Severity + metadata pills */}
          <div className="event-detail-pill-row">
            <span className={`sev-pill sev-${tier}`}>{tier.toUpperCase()} · SEV {sev}</span>
            {vMeta && (
              <span className="news-card-mini-badge" style={{ color: vMeta.color, borderColor: vMeta.color }}>
                {vMeta.label}
              </span>
            )}
            {lMeta && (
              <span className="news-card-mini-badge" style={{ color: lMeta.color, borderColor: lMeta.color }}>
                {lMeta.label}
              </span>
            )}
            {event.category && (
              <span className="tag mono news-card-mini-badge">
                {String(event.category).toUpperCase()}
              </span>
            )}
            {event.isoA2 && (
              <span className="mono" style={{ color: 'var(--ink-2)' }}>
                {event.isoA2}
              </span>
            )}
            {hasCoords && (
              <span className="mono" style={{ color: 'var(--ink-2)' }}>
                <MapPin size={10} aria-hidden style={{ marginRight: 2, verticalAlign: -1 }} />
                {Number(event.coordinates[1]).toFixed(2)}, {Number(event.coordinates[0]).toFixed(2)}
              </span>
            )}
          </div>

          {/* Title + summary */}
          <h1 className="event-detail-title">{event.title}</h1>
          {event.summary && (
            <p className="event-detail-summary">{event.summary}</p>
          )}

          {/* Metadata grid */}
          <dl className="event-detail-grid">
            <div className="event-detail-row">
              <dt>{t('eventDetail.source', 'Source')}</dt>
              <dd>
                {event.source || host || '—'}
                {event.url && (
                  <>
                    {' · '}
                    <a
                      className="news-card-read-more"
                      href={event.url}
                      target="_blank"
                      rel="noreferrer"
                      style={{ color: 'var(--amber)' }}
                    >
                      <ExternalLink size={11} aria-hidden /> {t('eventDetail.openArticle', 'Open Article')}
                    </a>
                  </>
                )}
              </dd>
            </div>
            <div className="event-detail-row">
              <dt>{t('eventDetail.published', 'Published')}</dt>
              <dd>{formatTs(event.publishedAt)}</dd>
            </div>
            {event.firstSeenAt && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.firstSeen', 'First Seen')}</dt>
                <dd>{formatTs(event.firstSeenAt)}</dd>
              </div>
            )}
            {event.region && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.region', 'Region')}</dt>
                <dd>
                  <Link
                    to={`/region/${event.isoA2 || ''}`}
                    style={{ color: 'var(--amber)', textDecoration: 'none' }}
                  >
                    {event.region}{event.locality ? ` · ${event.locality}` : ''}
                  </Link>
                </dd>
              </div>
            )}
            {confidence != null && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.confidence', 'Confidence')}</dt>
                <dd>{confidence}%</dd>
              </div>
            )}
            {event.sourceCredibility != null && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.sourceReliability', 'Source Reliability')}</dt>
                <dd>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                    <span style={{
                      display: 'inline-block',
                      width: 8,
                      height: 8,
                      borderRadius: '50%',
                      background: getReliabilityMeta(getReliabilityTier(event.sourceCredibility)).dotColor,
                    }} />
                    <span>{getReliabilityLabel(event.sourceCredibility)}</span>
                    <span style={{ color: 'var(--ink-2)' }}>
                      ({Math.round(event.sourceCredibility * 100)}%)
                    </span>
                  </span>
                </dd>
              </div>
            )}
            {typeof event.sourceCount === 'number' && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.sources', 'Sources')}</dt>
                <dd>
                  {event.sourceCount}
                  {typeof event.independentSourceCount === 'number'
                    ? ` · ${event.independentSourceCount} ${t('eventDetail.independent', 'independent')}`
                    : ''}
                </dd>
              </div>
            )}
            {event.geocodePrecision && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.precision', 'Precision')}</dt>
                <dd>{String(event.geocodePrecision).toUpperCase()}</dd>
              </div>
            )}
          </dl>

          {/* Supporting articles */}
          {supporting.length > 0 && (
            <section className="event-detail-section">
              <h2 className="event-detail-section-title">
                {t('eventDetail.supportingArticles', 'Supporting Articles')} ({supporting.length})
              </h2>
              <ul className="event-detail-source-list">
                {supporting.map((a, i) => (
                  <li key={`sa-${i}`}>
                    <a
                      className="event-detail-source-item"
                      href={a.url}
                      target="_blank"
                      rel="noreferrer"
                    >
                      {a.source || getSourceHost(a.url) || a.url}
                    </a>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>

        {/* Right column — entities + related events */}
        <aside className="event-detail-sidebar">
          {/* Entities */}
          {(orgs.length > 0 || people.length > 0 || locations.length > 0) && (
            <section className="event-detail-section">
              <h2 className="event-detail-section-title">
                {t('eventDetail.entities', 'Entities')}
              </h2>

              {locations.length > 0 && (
                <div className="event-detail-entity-group">
                  <div className="event-detail-entity-type">
                    {t('eventDetail.locations', 'Locations')}
                  </div>
                  <div className="event-detail-entity-chips">
                    {locations.map((loc, i) => (
                      <Link
                        key={`loc-${i}`}
                        to={`/entities`}
                        className="event-detail-entity-chip"
                        title={`${loc.name || loc}`}
                      >
                        <MapPin size={10} aria-hidden />
                        {loc.name || loc}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {orgs.length > 0 && (
                <div className="event-detail-entity-group">
                  <div className="event-detail-entity-type">
                    {t('eventDetail.organizations', 'Organizations')}
                  </div>
                  <div className="event-detail-entity-chips">
                    {orgs.map((org, i) => (
                      <Link
                        key={`org-${i}`}
                        to={`/entities`}
                        className="event-detail-entity-chip"
                        title={`${org.name || org}`}
                      >
                        {org.name || org}
                      </Link>
                    ))}
                  </div>
                </div>
              )}

              {people.length > 0 && (
                <div className="event-detail-entity-group">
                  <div className="event-detail-entity-type">
                    {t('eventDetail.people', 'People')}
                  </div>
                  <div className="event-detail-entity-chips">
                    {people.map((p, i) => (
                      <Link
                        key={`p-${i}`}
                        to={`/entities`}
                        className="event-detail-entity-chip"
                        title={`${p.name || p}`}
                      >
                        {p.name || p}
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </section>
          )}

          {/* Related events */}
          {relatedEvents.length > 0 && (
            <section className="event-detail-section">
              <h2 className="event-detail-section-title">
                {t('eventDetail.relatedEvents', 'Related Events')} ({relatedEvents.length})
              </h2>
              <div className="event-detail-related-list">
                {relatedEvents.map((rel) => {
                  const relTier = sevTier(rel.severity);
                  const relSev = ((rel.severity ?? 0) / 10).toFixed(1);
                  return (
                    <Link
                      key={rel.id}
                      to={`/event/${rel.id}`}
                      className="event-detail-related-item"
                    >
                      <div className="event-detail-related-meta">
                        <span className={`sev-pill sev-${relTier}`} style={{ fontSize: 9, padding: '1px 5px' }}>
                          {relTier.toUpperCase()} · {relSev}
                        </span>
                        {rel.isoA2 && (
                          <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 9 }}>
                            {rel.isoA2}
                          </span>
                        )}
                      </div>
                      <div className="event-detail-related-title">{rel.title}</div>
                    </Link>
                  );
                })}
              </div>
            </section>
          )}

          {/* No related events */}
          {relatedEvents.length === 0 && (
            <section className="event-detail-section">
              <h2 className="event-detail-section-title">
                {t('eventDetail.relatedEvents', 'Related Events')}
              </h2>
              <div className="mono" style={{ color: 'var(--ink-3)', fontSize: 10, letterSpacing: '0.08em' }}>
                {t('eventDetail.noRelatedEvents', 'No related events found')}
              </div>
            </section>
          )}
        </aside>
      </div>
    </div>
  );
}
