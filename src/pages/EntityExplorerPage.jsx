import React, { lazy, Suspense, useEffect, useMemo, useRef, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore.js';
import useFilterStore from '../stores/filterStore.js';
import {
  extractEntityGraph,
  filterGraphByType,
  getRelatedEvents,
  findShortestPath,
  searchEntitiesByName,
} from '../utils/entityGraph.js';
import PageLoadingFallback from '../components/PageLoadingFallback.jsx';
import useBreakpoint from '../hooks/useBreakpoint';
import BottomSheet from '../components/ui/BottomSheet';
import useKeyboardNavigation from '../hooks/useKeyboardNavigation';

const EntityRelationshipGraph = lazy(() => import('../components/EntityRelationshipGraph.jsx'));

const TYPE_STYLES = {
  organization: { color: 'var(--amber)', glyph: '■' },
  location: { color: 'var(--cyan)', glyph: '◆' },
  person: { color: 'var(--sev-green)', glyph: 'P' },
};

/** How many related events to show initially (load more on demand) */
const EVENTS_PER_PAGE = 15;

/**
 * /entities — tactical entity graph explorer.
 */
export default function EntityExplorerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const liveNews = useNewsStore((s) => s.liveNews);
  const backendEvents = useNewsStore((s) => s.backendEvents);
  const setEntityFilter = useFilterStore((s) => s.setEntityFilter);
  const entityFilter = useFilterStore((s) => s.entityFilter);
  const { isMobile } = useBreakpoint();

  const [selected, setSelected] = useState(null);
  const [selectedB, setSelectedB] = useState(null);     // second entity for shortest path
  const [size, setSize] = useState({ w: 900, h: 560 });
  const [searchQuery, setSearchQuery] = useState('');
  // Type filter: all enabled by default
  const [typeFilter, setTypeFilter] = useState({ people: true, organizations: true, locations: true });
  const [eventsShown, setEventsShown] = useState(EVENTS_PER_PAGE);
  const canvasRef = useRef(null);
  const searchInputRef = useRef(null);

  useEffect(() => {
    if (!liveNews) useNewsStore.getState().loadLiveData();
  }, [liveNews]);

  const events = useMemo(() => {
    if (backendEvents && backendEvents.length > 0) return backendEvents;
    return liveNews || [];
  }, [backendEvents, liveNews]);

  // Full graph from all events
  const fullGraph = useMemo(
    () => extractEntityGraph(events, { maxNodes: 50, maxEdgesPerNode: 4, minEdgeWeight: 2 }),
    [events],
  );

  // Apply type filter
  const typeFilteredGraph = useMemo(
    () => filterGraphByType(fullGraph, typeFilter),
    [fullGraph, typeFilter],
  );

  // Apply search filter on top of type filter
  const { nodes, edges } = useMemo(() => {
    if (!searchQuery || searchQuery.trim().length === 0) {
      return typeFilteredGraph;
    }
    const filteredNodes = searchEntitiesByName(typeFilteredGraph.nodes, searchQuery);
    const nodeIds = new Set(filteredNodes.map((n) => n.id));
    const filteredEdges = typeFilteredGraph.edges.filter(
      (e) => nodeIds.has(e.source) && nodeIds.has(e.target),
    );
    return { nodes: filteredNodes, edges: filteredEdges };
  }, [typeFilteredGraph, searchQuery]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      const e = entries[0];
      if (!e) return;
      setSize({ w: Math.max(480, e.contentRect.width), h: Math.max(320, e.contentRect.height) });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selNode = useMemo(() => nodes.find((n) => n.id === selected) || null, [nodes, selected]);
  const selNodeB = useMemo(() => nodes.find((n) => n.id === selectedB) || null, [nodes, selectedB]);

  // Calculate connected IDs for the primary selected entity
  const connectedIds = useMemo(() => {
    if (!selected) return new Set();
    const s = new Set();
    for (const e of edges) {
      if (e.source === selected) s.add(e.target);
      if (e.target === selected) s.add(e.source);
    }
    return s;
  }, [edges, selected]);

  const connectedNodes = useMemo(
    () => [...connectedIds].map((id) => nodes.find((n) => n.id === id)).filter(Boolean),
    [connectedIds, nodes],
  );

  // Shortest path between two selected entities
  const shortestPath = useMemo(() => {
    if (!selected || !selectedB) return [];
    return findShortestPath(selected, selectedB, edges);
  }, [selected, selectedB, edges]);

  // Full mention history for the selected entity
  const allRelatedEvents = useMemo(() => {
    if (!selNode) return [];
    return getRelatedEvents(events, selNode.name, selNode.type);
  }, [events, selNode]);

  const visibleEvents = useMemo(
    () => allRelatedEvents.slice(0, eventsShown),
    [allRelatedEvents, eventsShown],
  );

  // Reset events shown when selection changes
  useEffect(() => {
    setEventsShown(EVENTS_PER_PAGE);
  }, [selected]);

  const showMoreEvents = () => {
    setEventsShown((prev) => Math.min(prev + EVENTS_PER_PAGE, allRelatedEvents.length));
  };

  // Handle entity select — supports Shift+click for path mode
  const handleEntitySelect = useCallback((entityId, isShiftClick) => {
    if (!entityId) {
      setSelected(null);
      setSelectedB(null);
      return;
    }
    if (isShiftClick && selected) {
      // Shift+click: set second entity for path mode
      if (entityId === selected) {
        setSelectedB(null); // deselect second if same as first
      } else {
        setSelectedB(entityId);
      }
    } else {
      setSelected(entityId);
      setSelectedB(null); // clear path mode on normal click
    }
  }, [selected]);

  // Toggle a type filter chip
  const toggleTypeFilter = (type) => {
    setTypeFilter((prev) => ({
      ...prev,
      [type]: !prev[type],
    }));
    // Reset second selection when filter changes
    setSelectedB(null);
  };

  const showOnMap = () => {
    if (!selNode) return;
    setEntityFilter({ id: selNode.id, name: selNode.name, type: selNode.type });
    navigate('/');
  };

  const showTimeline = () => {
    if (!selNode) return;
    navigate(`/trends?tab=correlation&entity=${encodeURIComponent(selNode.name)}`);
  };

  const clearAll = () => {
    setSelected(null);
    setSelectedB(null);
    setSearchQuery('');
    setEventsShown(EVENTS_PER_PAGE);
  };

  /* ── Keyboard j/k navigation on entity list ── */
  const navigableEntities = useMemo(() => {
    return selNode ? connectedNodes : nodes;
  }, [selNode, connectedNodes, nodes]);

  const [kbEntityIdx, setKbEntityIdx] = useState(-1);

  const { getSelectedIndex: getEntityIdx } = useKeyboardNavigation({
    items: navigableEntities,
    searchSelector: '.search-input, .header-search input, .entity-search-input',
    onSelect: useCallback((entity) => {
      handleEntitySelect(entity.id, false);
    }, [handleEntitySelect]),
    onBookmark: useCallback(() => {}, []),
    onSaveView: useCallback(() => {}, []),
    onEscape: useCallback(() => {
      if (selNode) { clearAll(); return true; }
      return true;
    }, [selNode]),
    onHelp: useCallback(() => {
      window.dispatchEvent(new CustomEvent('mapr:openShortcutHelp'));
    }, []),
  });

  useEffect(() => {
    const interval = setInterval(() => {
      const current = getEntityIdx();
      setKbEntityIdx((prev) => (prev !== current ? current : prev));
    }, 50);
    return () => clearInterval(interval);
  }, [getEntityIdx]);

  const kbHighlightedEntityId = useMemo(() => {
    if (kbEntityIdx >= 0 && kbEntityIdx < navigableEntities.length) {
      return navigableEntities[kbEntityIdx]?.id || null;
    }
    return null;
  }, [kbEntityIdx, navigableEntities]);

  // / shortcut focuses the entity search input
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === '/' && document.activeElement !== searchInputRef.current
        && document.activeElement?.tagName !== 'INPUT'
        && document.activeElement?.tagName !== 'TEXTAREA'
        && !document.activeElement?.isContentEditable) {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const orgCount = nodes.filter((n) => n.type === 'organization').length;
  const locCount = nodes.filter((n) => n.type === 'location').length;
  const perCount = nodes.filter((n) => n.type === 'person').length;

  // ── Shared entity list item component ──
  const EntityListItem = ({ node }) => {
    const kbHighlighted = kbHighlightedEntityId === node.id;
    return (
      <div
        key={node.id}
        role="button"
        tabIndex={0}
        data-kb-highlighted={kbHighlighted ? 'true' : undefined}
        onClick={() => handleEntitySelect(node.id, false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleEntitySelect(node.id, false); }
        }}
        style={{
          padding: '5px 0',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          gap: 8,
          fontSize: 12,
          cursor: 'pointer',
          background: kbHighlighted ? 'var(--bg-2)' : undefined,
          boxShadow: kbHighlighted ? 'inset 2px 0 0 var(--cyan)' : undefined,
          paddingLeft: kbHighlighted ? '4px' : undefined,
        }}
      >
        <span style={{ width: 14, color: TYPE_STYLES[node.type]?.color, fontFamily: 'var(--ff-mono)' }}>
          {TYPE_STYLES[node.type]?.glyph}
        </span>
        <span style={{ flex: 1, color: 'var(--ink-0)' }}>{node.name}</span>
        <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 10 }}>{node.mentionCount}</span>
      </div>
    );
  };

  return (
    <div className="entities-page">
      {/* ── Search + type filter bar ── */}
      <div className="entity-top-bar">
        <div className="entity-search-wrap">
          <input
            ref={searchInputRef}
            type="text"
            className="entity-search-input"
            placeholder={t('entities.searchPlaceholder') || 'Search entities…'}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            aria-label={t('entities.searchAriaLabel') || 'Search entities by name'}
          />
          {searchQuery && (
            <button
              type="button"
              className="entity-search-clear"
              onClick={() => setSearchQuery('')}
              aria-label="Clear search"
              title="Clear search"
            >
              ×
            </button>
          )}
        </div>
        <div className="entity-type-chips" role="group" aria-label={t('entities.typeFilterAriaLabel') || 'Filter by entity type'}>
          <button
            type="button"
            className={`entity-type-chip${typeFilter.people ? ' active' : ''}`}
            onClick={() => toggleTypeFilter('people')}
            aria-pressed={typeFilter.people}
          >
            <span className="entity-type-chip-glyph" style={{ color: 'var(--sev-green)' }}>{TYPE_STYLES.person.glyph}</span>
            {t('entities.typePerson') || 'PER'}
            <span className="entity-type-chip-count">{perCount}</span>
          </button>
          <button
            type="button"
            className={`entity-type-chip${typeFilter.organizations ? ' active' : ''}`}
            onClick={() => toggleTypeFilter('organizations')}
            aria-pressed={typeFilter.organizations}
          >
            <span className="entity-type-chip-glyph" style={{ color: 'var(--amber)' }}>{TYPE_STYLES.organization.glyph}</span>
            {t('entities.typeOrg') || 'ORG'}
            <span className="entity-type-chip-count">{orgCount}</span>
          </button>
          <button
            type="button"
            className={`entity-type-chip${typeFilter.locations ? ' active' : ''}`}
            onClick={() => toggleTypeFilter('locations')}
            aria-pressed={typeFilter.locations}
          >
            <span className="entity-type-chip-glyph" style={{ color: 'var(--cyan)' }}>{TYPE_STYLES.location.glyph}</span>
            {t('entities.typeLoc') || 'LOC'}
            <span className="entity-type-chip-count">{locCount}</span>
          </button>
        </div>
      </div>

      <div className="entity-canvas" ref={canvasRef}>
        <Suspense fallback={<PageLoadingFallback />}>
          <EntityRelationshipGraph
            nodes={nodes}
            edges={edges}
            selectedEntity={selected}
            selectedEntityB={selectedB}
            pathHighlight={shortestPath}
            onEntitySelect={handleEntitySelect}
            width={size.w}
            height={size.h}
          />
        </Suspense>
        <div className="map-chrome">
          <div className="map-corner tl">
            <div>ENTITY GRAPH · 2B HORIZON</div>
            <div style={{ color: 'var(--ink-0)', marginTop: 4 }}>
              {nodes.length} NODES · {edges.length} EDGES
            </div>
            {entityFilter && (
              <div style={{ marginTop: 6 }}>
                <button type="button" className="btn sm" onClick={() => { useFilterStore.getState().clearEntityFilter(); }}>
                  CLEAR MAP FILTER
                </button>
              </div>
            )}
          </div>
          <div className="map-corner tr">
            <div style={{ display: 'flex', gap: 12 }}>
              <span><span style={{ color: 'var(--amber)' }}>{TYPE_STYLES.organization.glyph}</span> ORG · {orgCount}</span>
              <span><span style={{ color: 'var(--cyan)' }}>{TYPE_STYLES.location.glyph}</span> LOC · {locCount}</span>
              <span><span style={{ color: 'var(--sev-green)' }}>{TYPE_STYLES.person.glyph}</span> PERSON · {perCount}</span>
            </div>
          </div>
        </div>
      </div>

      {isMobile ? (
        <BottomSheet
          open={!!selNode}
          onClose={() => clearAll()}
          title={selNode?.name || 'Entity'}
          maxHeightVh={75}
        >
          {selNode && (
            <>
              <div style={{ padding: '12px 4px 14px' }}>
                <div className="micro" style={{ marginBottom: 6 }}>{selNode.type.toUpperCase()}</div>
                <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  DEG {connectedIds.size} · MENTIONS {selNode.mentionCount || 0}
                </div>
              </div>

              {selNodeB && (
                <div style={{ padding: '8px 4px', borderTop: '1px solid var(--cyan)', borderBottom: '1px solid var(--cyan)', background: 'rgba(94,199,212,0.06)' }}>
                  <div className="micro" style={{ color: 'var(--cyan)' }}>
                    PATH MODE · {selNodeB.name}
                  </div>
                  {shortestPath.length === 0 && (
                    <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, marginTop: 4 }}>
                      NO PATH FOUND
                    </div>
                  )}
                  {shortestPath.length > 0 && (
                    <div className="mono" style={{ color: 'var(--cyan)', fontSize: 10, marginTop: 4 }}>
                      {shortestPath.length - 1} HOP{shortestPath.length - 1 !== 1 ? 'S' : ''}
                    </div>
                  )}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 4px' }}>
                <div className="micro" style={{ marginBottom: 8 }}>CONNECTED · {connectedIds.size}</div>
                {connectedNodes.slice(0, 12).map((n) => (
                  <EntityListItem key={n.id} node={n} />
                ))}
                {connectedNodes.length === 0 && (
                  <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                    NO EDGES
                  </div>
                )}
              </div>

              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 4px' }}>
                <div className="micro" style={{ marginBottom: 8 }}>MENTION HISTORY · {allRelatedEvents.length}</div>
                {visibleEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{ padding: '8px 0', borderBottom: '1px solid var(--line)', fontSize: 12, color: 'var(--ink-1)' }}
                  >
                    <div style={{ color: 'var(--ink-0)' }}>{ev.title}</div>
                    <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, letterSpacing: '0.08em' }}>
                      {ev.isoA2 || '—'} · SEV {((ev.severity ?? 0) / 10).toFixed(1)}
                    </div>
                  </div>
                ))}
                {visibleEvents.length < allRelatedEvents.length && (
                  <button type="button" className="btn sm" onClick={showMoreEvents} style={{ marginTop: 8, width: '100%' }}>
                    SHOW MORE ({allRelatedEvents.length - visibleEvents.length} REMAINING)
                  </button>
                )}
                {allRelatedEvents.length === 0 && (
                  <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                    NO EVENTS
                  </div>
                )}
              </div>

              <div style={{ padding: '14px 4px', display: 'flex', gap: 8 }}>
                <button type="button" className="btn primary" onClick={showOnMap}>{t('entities.showOnMap') || 'SHOW ON MAP'}</button>
                <button type="button" className="btn" onClick={showTimeline}>{t('correlation.timelineButton') || 'TIMELINE'}</button>
                <button type="button" className="btn sm" onClick={clearAll}>CLEAR</button>
              </div>
            </>
          )}
        </BottomSheet>
      ) : (
        <aside className="entity-panel" aria-label="Selected entity">
          {!selNode ? (
            <div style={{ padding: '40px 20px', textAlign: 'center' }}>
              <div className="micro" style={{ marginBottom: 8 }}>{t('entities.noSelection') || 'NO ENTITY SELECTED'}</div>
              <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-2)' }}>
                {t('entities.noSelectionHint') || 'Click a node to inspect it. Shift+click a second node to find the shortest path.'}
              </p>
            </div>
          ) : (
            <>
              <div className="panel-header" style={{ height: 32 }}>
                <span className="dot" style={{ background: TYPE_STYLES[selNode.type]?.color || 'var(--amber)' }} />
                ENTITY · <span className="mono" style={{ color: 'var(--ink-0)', marginLeft: 4 }}>{selNode.id.slice(0, 18)}</span>
              </div>
              <div style={{ padding: '20px 20px 14px' }}>
                <div className="micro" style={{ marginBottom: 6 }}>{selNode.type.toUpperCase()}</div>
                <h2 style={{ fontFamily: 'var(--ff-serif)', fontWeight: 400, margin: '0 0 6px', fontSize: 24, color: 'var(--ink-0)' }}>
                  {selNode.name}
                </h2>
                <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, letterSpacing: '0.12em', textTransform: 'uppercase' }}>
                  DEG {connectedIds.size} · MENTIONS {selNode.mentionCount || 0}
                </div>
              </div>

              {/* ── Path mode indicator ── */}
              {selNodeB && (
                <div style={{ padding: '8px 20px', borderTop: '1px solid var(--cyan)', borderBottom: '1px solid var(--cyan)', background: 'rgba(94,199,212,0.06)' }}>
                  <div className="micro" style={{ color: 'var(--cyan)' }}>
                    SHORTEST PATH · {selNodeB.name}
                  </div>
                  {shortestPath.length === 0 ? (
                    <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, marginTop: 4, letterSpacing: '0.1em' }}>
                      NO PATH FOUND
                    </div>
                  ) : (
                    <div className="mono" style={{ color: 'var(--cyan)', fontSize: 10, marginTop: 4, letterSpacing: '0.1em' }}>
                      {shortestPath.length - 1} HOP{shortestPath.length - 1 !== 1 ? 'S' : ''} · {shortestPath.length} NODES
                    </div>
                  )}
                </div>
              )}

              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px' }}>
                <div className="micro" style={{ marginBottom: 8 }}>CONNECTED · {connectedIds.size}</div>
                {connectedNodes.slice(0, 12).map((n) => (
                  <EntityListItem key={n.id} node={n} />
                ))}
                {connectedNodes.length === 0 && (
                  <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                    NO EDGES
                  </div>
                )}
              </div>

              {/* ── Full mention history ── */}
              <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px', flex: 1, overflowY: 'auto', minHeight: 0 }}>
                <div className="micro" style={{ marginBottom: 8 }}>{t('entities.mentionHistory') || 'MENTION HISTORY'} · {allRelatedEvents.length}</div>
                {visibleEvents.map((ev) => (
                  <div
                    key={ev.id}
                    style={{ padding: '6px 0', borderBottom: '1px solid var(--line)', fontSize: 11, color: 'var(--ink-1)' }}
                  >
                    <div style={{ color: 'var(--ink-0)' }}>{ev.title}</div>
                    <div className="mono" style={{ color: 'var(--ink-2)', fontSize: 10, letterSpacing: '0.08em' }}>
                      {ev.isoA2 || '—'} · SEV {((ev.severity ?? 0) / 10).toFixed(1)}
                    </div>
                  </div>
                ))}
                {visibleEvents.length < allRelatedEvents.length && (
                  <button type="button" className="btn sm" onClick={showMoreEvents} style={{ marginTop: 8, width: '100%' }}>
                    {t('entities.showMore') || 'SHOW MORE'} ({allRelatedEvents.length - visibleEvents.length} {t('entities.remaining') || 'REMAINING'})
                  </button>
                )}
                {allRelatedEvents.length === 0 && (
                  <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                    NO EVENTS
                  </div>
                )}
              </div>

              <div style={{ padding: '14px 20px', display: 'flex', gap: 8, marginTop: 'auto' }}>
                <button type="button" className="btn primary" onClick={showOnMap}>{t('entities.showOnMap') || 'SHOW ON MAP'}</button>
                <button type="button" className="btn" onClick={showTimeline}>{t('correlation.timelineButton') || 'TIMELINE'}</button>
                <button type="button" className="btn" onClick={clearAll}>{t('entities.clear') || 'CLEAR'}</button>
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  );
}
