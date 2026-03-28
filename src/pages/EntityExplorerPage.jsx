import React, { useState, useEffect, useMemo, useCallback, useRef, lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import { Network, Users, Building2, MapPin, X, ExternalLink, ArrowLeft } from 'lucide-react';
import useNewsStore from '../stores/newsStore.js';
import { extractEntityGraph, filterGraphByType, getRelatedEvents } from '../utils/entityGraph.js';
import { getSeverityMeta } from '../utils/mockData.js';

const EntityRelationshipGraph = lazy(() => import('../components/EntityRelationshipGraph.jsx'));

/**
 * Entity explorer page — interactive graph visualization of entities
 * extracted from news events with type filtering and event detail panel.
 */
export default function EntityExplorerPage() {
  const { t } = useTranslation();
  const { liveNews, backendEvents, dataSource } = useNewsStore();

  /* ── Fetch data on mount — ensure data loads even when navigating directly ── */
  useEffect(() => {
    if (!liveNews) {
      useNewsStore.getState().loadLiveData();
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  /* ── Use backend events which have rich entity data from NER pipeline ── */
  const events = useMemo(() => {
    if (backendEvents && backendEvents.length > 0) return backendEvents;
    return [];
  }, [backendEvents]);

  /* ── Type filter state ── */
  const [typeFilter, setTypeFilter] = useState({
    people: true,
    organizations: true,
    locations: true,
  });

  /* ── Selected entity ── */
  const [selectedEntity, setSelectedEntity] = useState(null);

  /* ── Container size ── */
  const containerRef = useRef(null);
  const [dimensions, setDimensions] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      const rect = el.getBoundingClientRect();
      setDimensions({
        width: Math.max(400, Math.floor(rect.width)),
        height: Math.max(300, Math.floor(rect.height)),
      });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* ── Graph computation (cap at 150 nodes for canvas performance) ── */
  const fullGraph = useMemo(() => extractEntityGraph(events, { maxNodes: 150 }), [events]);
  const filteredGraph = useMemo(
    () => filterGraphByType(fullGraph, typeFilter),
    [fullGraph, typeFilter]
  );

  /* ── Selected entity node info (selectedEntity is now a typed id) ── */
  const selectedNode = useMemo(() => {
    if (!selectedEntity) return null;
    return fullGraph.nodes.find((n) => n.id === selectedEntity);
  }, [fullGraph, selectedEntity]);

  /* ── Related events for selected entity (using typed identity) ── */
  const relatedEvents = useMemo(() => {
    if (!selectedNode) return [];
    return getRelatedEvents(events, selectedNode.name, selectedNode.type);
  }, [events, selectedNode]);

  /* ── Toggle filter ── */
  const toggleType = useCallback((type) => {
    setTypeFilter((prev) => ({ ...prev, [type]: !prev[type] }));
  }, []);

  /* ── Stats ── */
  const stats = useMemo(() => ({
    totalEntities: fullGraph.nodes.length,
    people: fullGraph.nodes.filter((n) => n.type === 'person').length,
    organizations: fullGraph.nodes.filter((n) => n.type === 'organization').length,
    locations: fullGraph.nodes.filter((n) => n.type === 'location').length,
    connections: fullGraph.edges.length,
  }), [fullGraph]);

  const isLoading = !liveNews || dataSource === 'loading';

  return (
    <div className="entity-explorer">
      {/* Header */}
      <div className="entity-explorer-header">
        <div className="entity-explorer-title-row">
          <Network size={20} />
          <h1 className="entity-explorer-title">{t('entities.title')}</h1>
          {!isLoading && (
            <span className="entity-explorer-stats">
              {stats.totalEntities} {t('entities.entitiesLabel')} · {stats.connections} {t('entities.connectionsLabel')}
            </span>
          )}
        </div>

        {/* Type filter toggles */}
        <div className="entity-type-filters">
          <button
            className={`entity-type-btn entity-type-btn--person ${typeFilter.people ? 'is-active' : ''}`}
            onClick={() => toggleType('people')}
            aria-pressed={typeFilter.people}
          >
            <Users size={14} />
            <span>{t('entities.people')}</span>
            <span className="entity-type-count">{stats.people}</span>
          </button>
          <button
            className={`entity-type-btn entity-type-btn--org ${typeFilter.organizations ? 'is-active' : ''}`}
            onClick={() => toggleType('organizations')}
            aria-pressed={typeFilter.organizations}
          >
            <Building2 size={14} />
            <span>{t('entities.organizations')}</span>
            <span className="entity-type-count">{stats.organizations}</span>
          </button>
          <button
            className={`entity-type-btn entity-type-btn--location ${typeFilter.locations ? 'is-active' : ''}`}
            onClick={() => toggleType('locations')}
            aria-pressed={typeFilter.locations}
          >
            <MapPin size={14} />
            <span>{t('entities.locations')}</span>
            <span className="entity-type-count">{stats.locations}</span>
          </button>
        </div>
      </div>

      {/* Main content: graph + optional detail panel */}
      <div className="entity-explorer-body">
        <div
          className={`entity-graph-container ${selectedEntity ? 'has-detail' : ''}`}
          ref={containerRef}
        >
          {isLoading ? (
            <div className="entity-graph-loading">
              <Network size={32} className="entity-graph-loading-icon" />
              <span>{t('entities.loading')}</span>
            </div>
          ) : filteredGraph.nodes.length === 0 ? (
            <div className="entity-graph-empty">
              <Network size={32} />
              <span>{t('entities.noEntities')}</span>
            </div>
          ) : (
            <Suspense fallback={null}>
              <EntityRelationshipGraph
                nodes={filteredGraph.nodes}
                edges={filteredGraph.edges}
                selectedEntity={selectedEntity}
                onEntitySelect={setSelectedEntity}
                width={dimensions.width}
                height={dimensions.height}
              />
            </Suspense>
          )}
        </div>

        {/* Detail panel for selected entity */}
        {selectedEntity && selectedNode && (
          <div className="entity-detail-panel">
            <div className="entity-detail-header">
              <button
                className="entity-detail-close"
                onClick={() => setSelectedEntity(null)}
                aria-label={t('panel.closePanel')}
              >
                <X size={16} />
              </button>
              <div className={`entity-detail-type-badge entity-detail-type-badge--${selectedNode.type}`}>
                {selectedNode.type === 'person' && <Users size={12} />}
                {selectedNode.type === 'organization' && <Building2 size={12} />}
                {selectedNode.type === 'location' && <MapPin size={12} />}
                <span>{t(`entities.${selectedNode.type}`)}</span>
              </div>
              <h2 className="entity-detail-name">{selectedNode.name}</h2>
              <div className="entity-detail-meta">
                <span>{selectedNode.mentionCount} {t('entities.mentions')}</span>
                <span>·</span>
                <span>{relatedEvents.length} {t('entities.relatedEvents')}</span>
              </div>
            </div>

            <div className="entity-detail-events">
              <h3 className="entity-detail-events-title">{t('entities.relatedEventsTitle')}</h3>
              {relatedEvents.length === 0 ? (
                <p className="entity-detail-no-events">{t('entities.noRelatedEvents')}</p>
              ) : (
                <ul className="entity-detail-event-list">
                  {relatedEvents.slice(0, 20).map((event) => {
                    const meta = getSeverityMeta(event.severity);
                    return (
                      <li key={event.id} className="entity-detail-event-item">
                        <span
                          className="entity-detail-event-dot"
                          style={{ background: meta.accent }}
                        />
                        <div className="entity-detail-event-info">
                          <span className="entity-detail-event-title">{event.title}</span>
                          <span className="entity-detail-event-meta">
                            <span style={{ color: meta.accent }}>{meta.label}</span>
                            {event.region && <span> · {event.region}</span>}
                          </span>
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
