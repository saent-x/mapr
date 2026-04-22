import React, { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import useNewsStore from '../stores/newsStore.js';
import useFilterStore from '../stores/filterStore.js';
import { extractEntityGraph, getRelatedEvents } from '../utils/entityGraph.js';
import PageLoadingFallback from '../components/PageLoadingFallback.jsx';

const EntityRelationshipGraph = lazy(() => import('../components/EntityRelationshipGraph.jsx'));

const TYPE_STYLES = {
  organization: { color: 'var(--amber)', glyph: '■' },
  location: { color: 'var(--cyan)', glyph: '◆' },
  person: { color: 'var(--sev-green)', glyph: 'P' },
};

/**
 * /entities — tactical entity graph explorer.
 */
export default function EntityExplorerPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const liveNews = useNewsStore((s) => s.liveNews);
  const backendEvents = useNewsStore((s) => s.backendEvents);
  const setEntityFilter = useFilterStore((s) => s.setEntityFilter);

  const [selected, setSelected] = useState(null);
  const [size, setSize] = useState({ w: 900, h: 560 });
  const canvasRef = useRef(null);

  useEffect(() => {
    if (!liveNews) useNewsStore.getState().loadLiveData();
  }, [liveNews]);

  const events = useMemo(() => {
    if (backendEvents && backendEvents.length > 0) return backendEvents;
    return liveNews || [];
  }, [backendEvents, liveNews]);

  const { nodes, edges } = useMemo(
    () => extractEntityGraph(events, { maxNodes: 50, maxEdgesPerNode: 4, minEdgeWeight: 2 }),
    [events],
  );

  useEffect(() => {
    const el = canvasRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return undefined;
    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        setSize({ w: Math.max(480, e.contentRect.width), h: Math.max(320, e.contentRect.height) });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selNode = useMemo(() => nodes.find((n) => n.id === selected) || null, [nodes, selected]);

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

  const relatedEvents = useMemo(() => {
    if (!selNode) return [];
    return getRelatedEvents(events, selNode.name, selNode.type).slice(0, 8);
  }, [events, selNode]);

  const showOnMap = () => {
    if (!selNode) return;
    setEntityFilter({ id: selNode.id, name: selNode.name, type: selNode.type });
    navigate('/');
  };

  const orgCount = nodes.filter((n) => n.type === 'organization').length;
  const locCount = nodes.filter((n) => n.type === 'location').length;
  const perCount = nodes.filter((n) => n.type === 'person').length;

  return (
    <div className="entities-page">
      <div className="entity-canvas" ref={canvasRef}>
        <Suspense fallback={<PageLoadingFallback />}>
          <EntityRelationshipGraph
            nodes={nodes}
            edges={edges}
            selectedEntity={selected}
            onEntitySelect={(id) => setSelected(id)}
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

      <aside className="entity-panel" aria-label="Selected entity">
        {!selNode ? (
          <div style={{ padding: '40px 20px', textAlign: 'center' }}>
            <div className="micro" style={{ marginBottom: 8 }}>NO ENTITY SELECTED</div>
            <p style={{ color: 'var(--ink-2)', fontSize: 'var(--fs-2)' }}>
              Tap a node on the graph to inspect it and jump back to the map filtered by that entity.
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

            <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px' }}>
              <div className="micro" style={{ marginBottom: 8 }}>CONNECTED · {connectedIds.size}</div>
              {connectedNodes.slice(0, 12).map((n) => (
                <div
                  key={n.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelected(n.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelected(n.id); }
                  }}
                  style={{ padding: '5px 0', borderBottom: '1px solid var(--line)', display: 'flex', gap: 8, fontSize: 12, cursor: 'pointer' }}
                >
                  <span style={{ width: 14, color: TYPE_STYLES[n.type]?.color, fontFamily: 'var(--ff-mono)' }}>
                    {TYPE_STYLES[n.type]?.glyph}
                  </span>
                  <span style={{ flex: 1, color: 'var(--ink-0)' }}>{n.name}</span>
                  <span className="mono" style={{ color: 'var(--ink-2)', fontSize: 10 }}>{n.mentionCount}</span>
                </div>
              ))}
              {connectedNodes.length === 0 && (
                <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                  NO EDGES
                </div>
              )}
            </div>

            <div style={{ borderTop: '1px solid var(--line)', padding: '12px 20px' }}>
              <div className="micro" style={{ marginBottom: 8 }}>RELATED EVENTS · {relatedEvents.length}</div>
              {relatedEvents.map((ev) => (
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
              {relatedEvents.length === 0 && (
                <div style={{ color: 'var(--ink-3)', fontFamily: 'var(--ff-mono)', fontSize: 10, letterSpacing: '0.1em' }}>
                  NO EVENTS
                </div>
              )}
            </div>

            <div style={{ padding: '14px 20px', display: 'flex', gap: 8, marginTop: 'auto' }}>
              <button type="button" className="btn primary" onClick={showOnMap}>SHOW ON MAP</button>
              <button type="button" className="btn" onClick={() => setSelected(null)}>CLEAR</button>
            </div>
          </>
        )}
      </aside>
    </div>
  );
}
