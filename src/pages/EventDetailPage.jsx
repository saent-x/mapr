import React, { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { useParams, useNavigate, Link, useLocation } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ArrowLeft, ExternalLink, Loader2, MapPin, Pin } from 'lucide-react';
import useNewsStore from '../stores/newsStore';
import useSubscriptionStore from '../stores/subscriptionStore';
import { createThread } from '../services/backendService.js';
import { getRelatedEvents } from '../utils/entityGraph';
import { getSourceHost } from '../utils/urlUtils';
import { getReliabilityTier, getReliabilityMeta, getReliabilityLabel } from '../utils/credibilityMeta';
import { canonicalizeArticles } from '../utils/newsPipeline';
import { normalizeArticleText } from '../utils/articleText';
import { formatConfidencePercent, normalizeConfidenceScore } from '../utils/confidenceScore';
import { getEventDetailCandidates, resolveEventById } from '../utils/eventDetailResolver';
import MapLoadingFallback from '../components/MapLoadingFallback';
import MapErrorBoundary from '../components/MapErrorBoundary';

const FlatMap = lazy(() => import('../components/FlatMap'));
const SourceCredibilityPanel = lazy(() => import('../components/SourceCredibilityPanel.jsx'));
const BriefGenerator = lazy(() => import('../components/BriefGenerator.jsx'));

function formatTs(ts, locale) {
  if (!ts) return '—';
  const d = typeof ts === 'string' ? new Date(ts) : new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  try {
    return new Intl.DateTimeFormat(locale || undefined, {
      year: 'numeric', month: 'short', day: '2-digit',
      hour: '2-digit', minute: '2-digit',
    }).format(d);
  } catch {
    return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z';
  }
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
    // Legacy 'verified' label is misleading; map to CORROBORATED.
    case 'verified':
    case 'corroborated':
      return { label: 'CORROBORATED', color: 'var(--sev-green)' };
    case 'official':
      return { label: 'OFFICIAL', color: 'var(--cyan)' };
    case 'single-source':
      return { label: 'SINGLE SOURCE', color: 'var(--sev-amber)' };
    case 'amplified':
      return { label: 'AMPLIFIED', color: 'var(--sev-amber)' };
    default:
      return null;
  }
}

function entityName(entity) {
  return typeof entity === 'string' ? entity : entity?.name || '';
}

function entityExplorerLink(type, entity) {
  const name = entityName(entity);
  const params = new URLSearchParams({ type, entity: name });
  return `/entities?${params.toString()}`;
}

function PinThreadButton({ event }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const isAuthenticated = useSubscriptionStore((s) => s.isAuthenticated);
  const [state, setState] = useState('idle'); // idle | pending | pinned | error
  const [errMsg, setErrMsg] = useState('');

  if (!event || !event.id) return null;

  const handlePin = async () => {
    if (!isAuthenticated) {
      navigate('/account');
      return;
    }
    setState('pending');
    setErrMsg('');
    try {
      await createThread({
        title: event.title || 'Untitled event',
        seedEventId: event.id,
        seedArticleId: event.articleId || event.id,
      });
      setState('pinned');
    } catch (err) {
      setErrMsg(err.message || 'Failed');
      setState('error');
    }
  };

  if (state === 'pinned') {
    return (
      <Link to="/trends?tab=threads" className="btn" data-testid="pin-thread-pinned">
        <Pin size={14} aria-hidden /> {t('threads.pinned')}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className="btn"
      onClick={handlePin}
      disabled={state === 'pending'}
      data-testid="pin-thread-btn"
      title={state === 'error' ? errMsg : undefined}
    >
      <Pin size={14} aria-hidden />
      <span>{state === 'pending' ? t('threads.pinning', 'Pinning…') : t('threads.pin')}</span>
    </button>
  );
}

/**
 * /event/:id — dedicated event detail page with full metadata,
 * source links, entity list, map location, and related events.
 */
export default function EventDetailPage() {
  const { id } = useParams();
  const { t, i18n } = useTranslation();
  const locale = i18n?.language;
  const navigate = useNavigate();
  const location = useLocation();

  const liveNews = useNewsStore((s) => s.liveNews);
  const backendEvents = useNewsStore((s) => s.backendEvents);
  const historicalState = useNewsStore((s) => s.historicalState);
  const regionBackfills = useNewsStore((s) => s.regionBackfills);
  const dataSource = useNewsStore((s) => s.dataSource);
  const loadLiveData = useNewsStore((s) => s.loadLiveData);
  const [requestedDetailLoad, setRequestedDetailLoad] = useState(false);
  const routedEvent = location.state?.event || null;

  const baseEvents = useMemo(() => getEventDetailCandidates({
    liveNews,
    backendEvents,
    historicalState,
    regionBackfills,
  }), [liveNews, backendEvents, historicalState, regionBackfills]);

  const routedEventCandidate = useMemo(() => {
    if (!routedEvent || String(routedEvent.id) !== String(id)) return null;
    return canonicalizeArticles([routedEvent])[0] || routedEvent;
  }, [id, routedEvent]);

  const event = useMemo(() => (
    resolveEventById(baseEvents, id) || routedEventCandidate
  ), [baseEvents, id, routedEventCandidate]);

  const allEvents = useMemo(() => {
    if (!event) return baseEvents;
    return baseEvents.some((ev) => String(ev.id) === String(event.id)) ? baseEvents : [event, ...baseEvents];
  }, [baseEvents, event]);

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

  useEffect(() => {
    if (event || requestedDetailLoad || dataSource === 'loading') return;
    const hasAnyLoadedEvents = (backendEvents && backendEvents.length > 0) || (liveNews && liveNews.length > 0);
    if (hasAnyLoadedEvents) return;
    setRequestedDetailLoad(true);
    loadLiveData?.();
  }, [backendEvents, dataSource, event, liveNews, loadLiveData, requestedDetailLoad]);

  // Back button handler
  const handleBack = () => {
    navigate(-1);
  };

  const waitingForEvents = !event && (
    dataSource === 'loading' ||
    (!requestedDetailLoad && !((backendEvents && backendEvents.length > 0) || (liveNews && liveNews.length > 0)))
  );

  if (waitingForEvents) {
    return (
      <div className="event-detail-page">
        <div className="event-detail-not-found">
          <Loader2 size={22} className="admin-spinner" aria-hidden />
          <div className="micro" style={{ marginTop: 12, marginBottom: 12 }}>
            {t('eventDetail.loading', 'LOADING EVENT')}
          </div>
          <p style={{ color: 'var(--ink-2)', fontSize: 13, marginBottom: 0 }}>
            {t('eventDetail.loadingHint', 'Refreshing the current event set before showing detail.')}
          </p>
        </div>
      </div>
    );
  }

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
  const confidence = normalizeConfidenceScore(event.confidence);
  const supporting = Array.isArray(event.supportingArticles)
    ? event.supportingArticles.filter((a) => a && a.url && a.url !== event.url).slice(0, 8)
    : [];
  const orgs = event.entities?.organizations?.slice(0, 10) || [];
  const people = event.entities?.people?.slice(0, 10) || [];
  const locations = event.entities?.locations?.slice(0, 10) || [];
  const hasCoords = Array.isArray(event.coordinates) && event.coordinates.length >= 2;

  return (
    <div className="event-detail-page">
      {/* Back + actions row */}
      <div className="event-detail-toolbar">
        <button
          type="button"
          className="event-detail-back"
          onClick={handleBack}
          aria-label={t('eventDetail.back', 'Back')}
        >
          <ArrowLeft size={16} aria-hidden />
          <span>{t('eventDetail.back', 'Back')}</span>
        </button>
        <PinThreadButton event={event} />
      </div>

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
            <p className="event-detail-summary">{normalizeArticleText(event.summary)}</p>
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
              <dd>{formatTs(event.publishedAt, locale)}</dd>
            </div>
            {event.firstSeenAt && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.firstSeen', 'First Seen')}</dt>
                <dd>{formatTs(event.firstSeenAt, locale)}</dd>
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
                <dt>{t('eventDetail.confidence', 'Event Confidence')}</dt>
                <dd>{formatConfidencePercent(event.confidence)}</dd>
              </div>
            )}
            {event.sourceCredibility != null && (
              <div className="event-detail-row">
                <dt>{t('eventDetail.sourceReliability', 'Source Corroboration')}</dt>
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
          <Suspense fallback={<div className="event-detail-section credibility-loading mono">Loading…</div>}>
            <SourceCredibilityPanel eventId={event.id} />
          </Suspense>

          <Suspense fallback={null}>
            <BriefGenerator event={event} />
          </Suspense>

          {hasCoords && (
            <section className="event-detail-section event-detail-location-section">
              <h2 className="event-detail-section-title">
                {t('eventDetail.location', 'Location')}
              </h2>
              <div className="event-detail-map">
                <MapErrorBoundary>
                  <Suspense fallback={<MapLoadingFallback />}>
                    <FlatMap
                      newsList={[event]}
                      regionSeverities={{}}
                      mapOverlay="severity"
                      coverageStatusByIso={{}}
                      perCountryReliability={{}}
                      velocitySpikes={[]}
                      trackingPoints={[]}
                      selectedRegion={event.isoA2 || null}
                      selectedStory={event}
                      onRegionSelect={() => {}}
                      onStorySelect={() => {}}
                      onArcSelect={() => {}}
                      onCoverageCountryClick={() => {}}
                      compact
                    />
                  </Suspense>
                </MapErrorBoundary>
              </div>
            </section>
          )}

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
                        to={entityExplorerLink('location', loc)}
                        className="event-detail-entity-chip"
                        title={`${entityName(loc)}`}
                      >
                        <MapPin size={10} aria-hidden />
                        {entityName(loc)}
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
                        to={entityExplorerLink('organization', org)}
                        className="event-detail-entity-chip"
                        title={`${entityName(org)}`}
                      >
                        {entityName(org)}
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
                        to={entityExplorerLink('person', p)}
                        className="event-detail-entity-chip"
                        title={`${entityName(p)}`}
                      >
                        {entityName(p)}
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
                      to={`/event/${encodeURIComponent(rel.id)}`}
                      state={{ event: rel }}
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
