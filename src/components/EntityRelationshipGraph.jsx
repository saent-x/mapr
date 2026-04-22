import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Force-directed entity relationship graph on HTML5 Canvas with pan/zoom.
 *
 * - World 2.0x viewport so type zones have real room.
 * - Simulation never freezes: alpha floors at 0.1 so nodes always breathe;
 *   selection and drag reheat the sim.
 * - Collision pass iteratively resolves node overlap each tick — fixes the
 *   "sponge" clumping that Coulomb repulsion alone can't.
 * - On select, connected nodes pull in closer and the selected node pulses.
 * - Pan is always free (soft slack) — no need to zoom in before dragging.
 */

const TYPE_COLORS = {
  person: '#3d9b6b',
  organization: '#e8a33d',
  location: '#5ec7d4',
};
const TYPE_LABELS = { person: 'Person', organization: 'Organization', location: 'Location' };

const INK_0 = '#e8e6df';
const INK_2 = 'rgba(232, 230, 223, 0.55)';
const INK_3 = 'rgba(232, 230, 223, 0.28)';
const EDGE_BASE = 'rgba(50, 56, 70, 0.55)';
const EDGE_DIM  = 'rgba(38, 43, 53, 0.35)';
const EDGE_HIGH = 'rgba(232, 163, 61, 0.8)';
const SELECT_RING = '#e8a33d';

const MIN_NODE_RADIUS = 7;
const MAX_NODE_RADIUS = 26;
const LABEL_FONT = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';

const PREWARM_TICKS = 260;
const WORLD_SCALE = 2.0;
const ZOOM_MIN = 0.25;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.15;
const DRAG_THRESHOLD = 4;

const ALPHA_FLOOR = 0.12;         // sim never fully cools
const ALPHA_DECAY = 0.992;
const REHEAT_ALPHA = 0.65;        // on select / drag node

const COLLIDE_ITERATIONS = 3;
const COLLIDE_PADDING = 6;        // extra px between node surfaces

/* ── Type anchors in WORLD coords ── */
function typeAnchors(worldW, worldH) {
  const cx = worldW / 2;
  const cy = worldH / 2;
  return {
    organization: { x: cx - worldW * 0.32, y: cy - worldH * 0.26 },
    location:     { x: cx + worldW * 0.32, y: cy - worldH * 0.26 },
    person:       { x: cx,                 y: cy + worldH * 0.30 },
  };
}

function nodeRadius(mentionCount, maxMentions) {
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function initSimulation(nodes, edges, worldW, worldH) {
  const anchors = typeAnchors(worldW, worldH);
  const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount || 1));
  const zoneW = worldW * 0.42;
  const zoneH = worldH * 0.42;

  const simNodes = nodes.map((n) => {
    const a = anchors[n.type] || { x: worldW / 2, y: worldH / 2 };
    return {
      ...n,
      anchorX: a.x,
      anchorY: a.y,
      x: a.x + (Math.random() - 0.5) * zoneW,
      y: a.y + (Math.random() - 0.5) * zoneH,
      vx: 0,
      vy: 0,
      radius: nodeRadius(n.mentionCount, maxMentions),
    };
  });

  const nodeIndex = new Map(simNodes.map((n) => [n.id, n]));
  const simEdges = edges
    .map((e) => ({
      ...e,
      sourceNode: nodeIndex.get(e.source),
      targetNode: nodeIndex.get(e.target),
    }))
    .filter((e) => e.sourceNode && e.targetNode);

  return { simNodes, simEdges, nodeIndex };
}

function tickSimulation(simNodes, simEdges, worldW, worldH, alpha, selectedId, connectedSet) {
  const k = alpha;
  const BOUND_PAD = 40;
  const hasSelection = !!selectedId;

  // 1. Pairwise Coulomb repulsion
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minSep = a.radius + b.radius + 72;
      const charge = dist < minSep ? 3200 : 1500;
      const force = (charge * k) / (dist * dist);
      const ux = dx / dist;
      const uy = dy / dist;
      a.vx -= ux * force;
      a.vy -= uy * force;
      b.vx += ux * force;
      b.vy += uy * force;
    }
  }

  // 2. Edge springs — connected-to-selected pull shorter (cluster in)
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const involvesSelected = hasSelection && (edge.source === selectedId || edge.target === selectedId);
    const idealDist = involvesSelected ? 110 : 180;
    const stiffness = involvesSelected ? 0.006 : 0.003;
    const force = (dist - idealDist) * stiffness * k * Math.min(edge.weight || 1, 5);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // 3. Type-anchor spring
  for (const node of simNodes) {
    node.vx += (node.anchorX - node.x) * 0.0045 * k;
    node.vy += (node.anchorY - node.y) * 0.0045 * k;
  }

  // 4. Selection: extra repulsion from selected for NON-connected nodes
  if (hasSelection) {
    const sel = simNodes.find((n) => n.id === selectedId);
    if (sel) {
      for (const node of simNodes) {
        if (node.id === selectedId) continue;
        if (connectedSet.has(node.id)) continue;
        const dx = node.x - sel.x;
        const dy = node.y - sel.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 240) {
          const push = (240 - dist) * 0.012 * k;
          node.vx += (dx / dist) * push;
          node.vy += (dy / dist) * push;
        }
      }
    }
  }

  // 5. Thermal jitter — prevents deadlock when alpha is low
  for (const node of simNodes) {
    node.vx += (Math.random() - 0.5) * 0.4 * k;
    node.vy += (Math.random() - 0.5) * 0.4 * k;
  }

  // 6. Soft bounds
  for (const node of simNodes) {
    const r = node.radius;
    const leftP  = (r + BOUND_PAD) - node.x;
    const rightP = node.x - (worldW - r - BOUND_PAD);
    const topP   = (r + BOUND_PAD) - node.y;
    const botP   = node.y - (worldH - r - BOUND_PAD);
    if (leftP  > 0) node.vx += leftP  * 0.02;
    if (rightP > 0) node.vx -= rightP * 0.02;
    if (topP   > 0) node.vy += topP   * 0.02;
    if (botP   > 0) node.vy -= botP   * 0.02;
  }

  // 7. Integrate with damping
  for (const node of simNodes) {
    node.vx *= 0.88;
    node.vy *= 0.88;
    node.x += node.vx;
    node.y += node.vy;
  }

  // 8. Iterative collision resolution (position-level, not velocity)
  for (let it = 0; it < COLLIDE_ITERATIONS; it++) {
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minD = a.radius + b.radius + COLLIDE_PADDING;
        if (dist < minD) {
          const overlap = (minD - dist) * 0.5;
          const ux = dx / dist;
          const uy = dy / dist;
          a.x -= ux * overlap;
          a.y -= uy * overlap;
          b.x += ux * overlap;
          b.y += uy * overlap;
        }
      }
    }
  }
}

function drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, viewport, view, worldW, worldH, pulse) {
  const { width, height } = viewport;
  ctx.clearRect(0, 0, width, height);

  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  // World frame
  ctx.strokeStyle = 'rgba(50, 56, 70, 0.35)';
  ctx.setLineDash([4, 10]);
  ctx.lineWidth = 1 / view.scale;
  ctx.strokeRect(0, 0, worldW, worldH);
  ctx.setLineDash([]);

  const connectedIds = new Set();
  if (selectedEntity) {
    connectedIds.add(selectedEntity);
    for (const edge of simEdges) {
      if (edge.source === selectedEntity) connectedIds.add(edge.target);
      if (edge.target === selectedEntity) connectedIds.add(edge.source);
    }
  }

  // Edges
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const isHighlighted = selectedEntity
      ? connectedIds.has(edge.source) && connectedIds.has(edge.target)
      : false;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.strokeStyle = isHighlighted
      ? EDGE_HIGH
      : selectedEntity ? EDGE_DIM : EDGE_BASE;
    const w = isHighlighted
      ? Math.min((edge.weight || 1) + 0.5, 4)
      : Math.min((edge.weight || 1) * 0.5, 2);
    ctx.lineWidth = w / view.scale;
    ctx.stroke();
  }

  // Nodes
  for (const node of simNodes) {
    const isSelected = node.id === selectedEntity;
    const isHovered  = node.id === hoveredEntity;
    const isConnected = connectedIds.has(node.id);
    const dimmed = selectedEntity && !isConnected;
    const color = TYPE_COLORS[node.type] || '#999';

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    ctx.fillStyle = dimmed ? `${color}33` : color;
    ctx.fill();

    if (isSelected) {
      // Pulsing outer ring
      const pulseR = node.radius + 6 + Math.sin(pulse) * 3;
      ctx.beginPath();
      ctx.arc(node.x, node.y, pulseR, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.globalAlpha = 0.55 + Math.cos(pulse) * 0.25;
      ctx.lineWidth = 2 / view.scale;
      ctx.stroke();
      ctx.globalAlpha = 1;
      // Solid inner ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 2.5, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 2 / view.scale;
      ctx.stroke();
    }
    if (isHovered && !isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = INK_2;
      ctx.lineWidth = 1 / view.scale;
      ctx.stroke();
    }

    if (node.radius > 10 || isSelected || isHovered || (isConnected && selectedEntity)) {
      const sx = node.x * view.scale + view.tx;
      const sy = (node.y + node.radius + 4) * view.scale + view.ty;
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dimmed ? INK_3 : INK_0;
      ctx.fillText(node.name, sx, sy);
      ctx.restore();
    }
  }

  ctx.restore();
}

// Soft clamp: always allow some pan, even when world fits viewport
function clampView(view, viewport, worldW, worldH) {
  const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.scale));
  const { width, height } = viewport;
  const slackPad = 160; // extra px of pan slack beyond world edges
  const worldPxW = worldW * scale;
  const worldPxH = worldH * scale;
  // tx range: world's right edge can pan at least to slackPad from left edge of viewport,
  // and world's left edge can pan up to slackPad past right edge of viewport (never fully off-screen).
  const txMin = Math.min(0, width  - worldPxW) - slackPad;
  const txMax = Math.max(0, width  - worldPxW) + slackPad;
  const tyMin = Math.min(0, height - worldPxH) - slackPad;
  const tyMax = Math.max(0, height - worldPxH) + slackPad;
  return {
    scale,
    tx: Math.max(txMin, Math.min(txMax, view.tx)),
    ty: Math.max(tyMin, Math.min(tyMax, view.ty)),
  };
}

function fitView(viewport, worldW, worldH) {
  const sx = viewport.width  / worldW;
  const sy = viewport.height / worldH;
  const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(sx, sy)));
  const tx = (viewport.width  - worldW * scale) / 2;
  const ty = (viewport.height - worldH * scale) / 2;
  return { scale, tx, ty };
}

export default function EntityRelationshipGraph({
  nodes = [],
  edges = [],
  events = [],
  selectedEntity,
  onEntitySelect,
  width = 800,
  height = 600,
}) {
  const canvasRef = useRef(null);
  const wrapperRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const alphaRef = useRef(1);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const connectedRef = useRef(new Set());
  const viewRef = useRef({ scale: 1, tx: 0, ty: 0 });
  const dragRef = useRef(null);
  const pulseRef = useRef(0);

  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const [, forceTick] = useState(0);

  const worldW = Math.max(400, width * WORLD_SCALE);
  const worldH = Math.max(320, height * WORLD_SCALE);

  const eventById = useMemo(() => {
    const m = new Map();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const tooltipData = useMemo(() => {
    if (!hoveredEntity || !simRef.current) return null;
    const node = simRef.current.simNodes.find((n) => n.id === hoveredEntity);
    if (!node) return null;
    const connectionCount = simRef.current.simEdges.filter(
      (e) => e.source === node.id || e.target === node.id,
    ).length;
    const eventTitles = (node.eventIds || [])
      .slice(0, 3)
      .map((eid) => eventById.get(eid)?.title)
      .filter(Boolean);
    return {
      name: node.name,
      type: TYPE_LABELS[node.type] || node.type,
      color: TYPE_COLORS[node.type] || '#999',
      mentions: node.mentionCount || 0,
      connections: connectionCount,
      eventCount: (node.eventIds || []).length,
      eventTitles,
    };
  }, [hoveredEntity, eventById]);

  // Track selection + connected set for the sim
  useEffect(() => {
    selectedRef.current = selectedEntity || null;
    const set = new Set();
    if (selectedEntity && simRef.current) {
      set.add(selectedEntity);
      for (const edge of simRef.current.simEdges) {
        if (edge.source === selectedEntity) set.add(edge.target);
        if (edge.target === selectedEntity) set.add(edge.source);
      }
    }
    connectedRef.current = set;
    // Reheat so the graph reorganises around the selected node
    alphaRef.current = Math.max(alphaRef.current, REHEAT_ALPHA);
  }, [selectedEntity]);

  // Build sim when data/size changes
  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      simRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d').clearRect(0, 0, width, height);
      return undefined;
    }

    const sim = initSimulation(nodes, edges, worldW, worldH);
    simRef.current = sim;
    alphaRef.current = 1;
    viewRef.current = fitView({ width, height }, worldW, worldH);

    // Pre-warm with no selection
    for (let i = 0; i < PREWARM_TICKS; i++) {
      tickSimulation(sim.simNodes, sim.simEdges, worldW, worldH, alphaRef.current, null, connectedRef.current);
      alphaRef.current = Math.max(ALPHA_FLOOR, alphaRef.current * ALPHA_DECAY);
    }

    let running = true;
    const animate = () => {
      if (!running || !simRef.current) return;
      const { simNodes, simEdges } = simRef.current;
      tickSimulation(simNodes, simEdges, worldW, worldH, alphaRef.current, selectedRef.current, connectedRef.current);
      alphaRef.current = Math.max(ALPHA_FLOOR, alphaRef.current * ALPHA_DECAY);
      pulseRef.current += 0.12;

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        drawGraph(
          ctx, simNodes, simEdges,
          selectedRef.current, hoveredRef.current,
          { width, height }, viewRef.current, worldW, worldH,
          pulseRef.current,
        );
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height, worldW, worldH]);

  // Hover drives a state update for tooltip, but sim loop already redraws each frame

  const screenToWorld = useCallback((sx, sy) => {
    const v = viewRef.current;
    return { x: (sx - v.tx) / v.scale, y: (sy - v.ty) / v.scale };
  }, []);

  const findNodeAt = useCallback((clientX, clientY) => {
    if (!canvasRef.current || !simRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = clientX - rect.left;
    const sy = clientY - rect.top;
    const { x: wx, y: wy } = screenToWorld(sx, sy);
    const { simNodes } = simRef.current;
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const node = simNodes[i];
      const dx = node.x - wx;
      const dy = node.y - wy;
      const hit = node.radius + 4;
      if (dx * dx + dy * dy <= hit * hit) return node;
    }
    return null;
  }, [screenToWorld]);

  const handleMouseDown = useCallback((e) => {
    if (e.button !== 0) return;
    dragRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      moved: false,
      startView: { ...viewRef.current },
    };
  }, []);

  const handleMouseMove = useCallback((e) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        d.moved = true;
        if (canvasRef.current) canvasRef.current.style.cursor = 'grabbing';
        setTooltipPos(null);
        setHoveredEntity(null);
      }
      if (d.moved) {
        viewRef.current = clampView(
          { scale: d.startView.scale, tx: d.startView.tx + dx, ty: d.startView.ty + dy },
          { width, height }, worldW, worldH,
        );
        return;
      }
    }
    const node = findNodeAt(e.clientX, e.clientY);
    const id = node ? node.id : null;
    if (id !== hoveredRef.current) {
      hoveredRef.current = id;
      setHoveredEntity(id);
    }
    if (node && wrapperRef.current) {
      const wrect = wrapperRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - wrect.left + 12,
        y: e.clientY - wrect.top - 8,
      });
    } else {
      setTooltipPos(null);
    }
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? 'pointer' : 'grab';
    }
  }, [findNodeAt, width, height, worldW, worldH]);

  const handleMouseUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
    if (!d) return;
    if (!d.moved) {
      const node = findNodeAt(e.clientX, e.clientY);
      if (node) {
        onEntitySelect?.(node.id === selectedEntity ? null : node.id);
        alphaRef.current = REHEAT_ALPHA;
      } else {
        onEntitySelect?.(null);
      }
    }
  }, [findNodeAt, onEntitySelect, selectedEntity]);

  const handleMouseLeave = useCallback(() => {
    if (dragRef.current) dragRef.current = null;
    hoveredRef.current = null;
    setHoveredEntity(null);
    setTooltipPos(null);
    if (canvasRef.current) canvasRef.current.style.cursor = 'grab';
  }, []);

  const handleWheel = useCallback((e) => {
    e.preventDefault();
    const rect = canvasRef.current.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const v = viewRef.current;
    const delta = -e.deltaY;
    const factor = delta > 0 ? ZOOM_STEP : 1 / ZOOM_STEP;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.scale * factor));
    const ratio = newScale / v.scale;
    const tx = sx - (sx - v.tx) * ratio;
    const ty = sy - (sy - v.ty) * ratio;
    viewRef.current = clampView({ scale: newScale, tx, ty }, { width, height }, worldW, worldH);
  }, [width, height, worldW, worldH]);

  useEffect(() => {
    const el = canvasRef.current;
    if (!el) return undefined;
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [handleWheel]);

  const zoomBy = useCallback((factor) => {
    const v = viewRef.current;
    const newScale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, v.scale * factor));
    const cx = width / 2;
    const cy = height / 2;
    const ratio = newScale / v.scale;
    const tx = cx - (cx - v.tx) * ratio;
    const ty = cy - (cy - v.ty) * ratio;
    viewRef.current = clampView({ scale: newScale, tx, ty }, { width, height }, worldW, worldH);
    forceTick((t) => t + 1);
  }, [width, height, worldW, worldH]);

  const resetView = useCallback(() => {
    viewRef.current = fitView({ width, height }, worldW, worldH);
    alphaRef.current = Math.max(alphaRef.current, REHEAT_ALPHA);
    forceTick((t) => t + 1);
  }, [width, height, worldW, worldH]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        className="entity-graph-canvas"
        width={width}
        height={height}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label="Entity relationship graph"
      />
      <div className="entity-graph-zoom">
        <button type="button" aria-label="Zoom in"  onClick={() => zoomBy(ZOOM_STEP * ZOOM_STEP)}>+</button>
        <button type="button" aria-label="Zoom out" onClick={() => zoomBy(1 / (ZOOM_STEP * ZOOM_STEP))}>−</button>
        <button type="button" aria-label="Reset view" onClick={resetView}>⤢</button>
      </div>
      {tooltipData && tooltipPos && (
        <div className="entity-tooltip" style={{ left: tooltipPos.x, top: tooltipPos.y }}>
          <div className="entity-tooltip-header">
            <span className="entity-tooltip-badge" style={{ background: tooltipData.color }}>
              {tooltipData.type}
            </span>
            <span className="entity-tooltip-name">{tooltipData.name}</span>
          </div>
          <div className="entity-tooltip-stats">
            <span>{tooltipData.mentions} mention{tooltipData.mentions !== 1 ? 's' : ''}</span>
            <span className="entity-tooltip-sep" />
            <span>{tooltipData.connections} connection{tooltipData.connections !== 1 ? 's' : ''}</span>
            <span className="entity-tooltip-sep" />
            <span>{tooltipData.eventCount} event{tooltipData.eventCount !== 1 ? 's' : ''}</span>
          </div>
          {tooltipData.eventTitles.length > 0 && (
            <ul className="entity-tooltip-events">
              {tooltipData.eventTitles.map((title, i) => (
                <li key={i}>{title}</li>
              ))}
              {tooltipData.eventCount > 3 && (
                <li className="entity-tooltip-more">+{tooltipData.eventCount - 3} more</li>
              )}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
