import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Force-directed entity relationship graph on HTML5 Canvas.
 *
 * Nodes cluster by type (organizations top-left, locations top-right, persons
 * bottom-centre) via per-type anchor springs — gives three visible groupings
 * while staying physics-based. No global centre gravity, so the graph spreads
 * across the canvas instead of collapsing into a ball.
 *
 * Props:
 *  - nodes: Array<{ id, name, type, mentionCount, eventIds }>
 *  - edges: Array<{ source, target, weight, sharedEventIds }>
 *  - events: Array<{ id, title }>
 *  - selectedEntity: string | null
 *  - onEntitySelect: (id: string | null) => void
 *  - width, height: number
 */

const TYPE_COLORS = {
  person: '#3d9b6b',        // --sev-green
  organization: '#e8a33d',  // --amber
  location: '#5ec7d4',      // --cyan
};
const TYPE_LABELS = { person: 'Person', organization: 'Organization', location: 'Location' };

const INK_0 = '#e8e6df';
const INK_2 = 'rgba(232, 230, 223, 0.55)';
const INK_3 = 'rgba(232, 230, 223, 0.28)';
const EDGE_BASE = 'rgba(50, 56, 70, 0.55)';
const EDGE_DIM  = 'rgba(38, 43, 53, 0.35)';
const EDGE_HIGH = 'rgba(232, 163, 61, 0.7)';
const SELECT_RING = '#e8a33d';

const MIN_NODE_RADIUS = 7;
const MAX_NODE_RADIUS = 26;
const LABEL_FONT = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
const SELECTED_RING = 3;

const PREWARM_TICKS = 200;

/* ── Type anchors: three zones spread across canvas ── */
function typeAnchors(width, height) {
  const cx = width / 2;
  const cy = height / 2;
  return {
    organization: { x: cx - width * 0.28, y: cy - height * 0.22 },
    location:     { x: cx + width * 0.28, y: cy - height * 0.22 },
    person:       { x: cx,                y: cy + height * 0.24 },
  };
}

function nodeRadius(mentionCount, maxMentions) {
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function initSimulation(nodes, edges, width, height) {
  const anchors = typeAnchors(width, height);
  const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount || 1));
  const zoneW = width * 0.32;
  const zoneH = height * 0.32;

  const simNodes = nodes.map((n) => {
    const a = anchors[n.type] || { x: width / 2, y: height / 2 };
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

function tickSimulation(simNodes, simEdges, width, height, alpha) {
  const k = alpha;
  const BOUND_PAD = 24;

  // 1. Pairwise repulsion — stronger short-range, sustained long-range floor
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minSep = a.radius + b.radius + 56;
      const charge = dist < minSep ? 2200 : 1100;
      const force = (charge * k) / (dist * dist);
      const ux = dx / dist;
      const uy = dy / dist;
      a.vx -= ux * force;
      a.vy -= uy * force;
      b.vx += ux * force;
      b.vy += uy * force;
    }
  }

  // 2. Edge springs — shorter ideal distance since zones handle separation
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const idealDist = 140;
    const force = (dist - idealDist) * 0.0028 * k * Math.min(edge.weight || 1, 5);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // 3. Type anchor spring — each node pulled toward its type's zone
  for (const node of simNodes) {
    node.vx += (node.anchorX - node.x) * 0.004 * k;
    node.vy += (node.anchorY - node.y) * 0.004 * k;
  }

  // 4. Soft bounds — restoring force when near canvas edge (no hard clamp)
  for (const node of simNodes) {
    const r = node.radius;
    const leftP  = (r + BOUND_PAD) - node.x;
    const rightP = node.x - (width - r - BOUND_PAD);
    const topP   = (r + BOUND_PAD) - node.y;
    const botP   = node.y - (height - r - BOUND_PAD);
    if (leftP  > 0) node.vx += leftP  * 0.02;
    if (rightP > 0) node.vx -= rightP * 0.02;
    if (topP   > 0) node.vy += topP   * 0.02;
    if (botP   > 0) node.vy -= botP   * 0.02;
  }

  // 5. Integrate with damping
  for (const node of simNodes) {
    node.vx *= 0.86;
    node.vy *= 0.86;
    node.x += node.vx;
    node.y += node.vy;
  }
}

function drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, width, height) {
  ctx.clearRect(0, 0, width, height);

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
      : selectedEntity
        ? EDGE_DIM
        : EDGE_BASE;
    ctx.lineWidth = isHighlighted
      ? Math.min(edge.weight || 1, 4)
      : Math.min((edge.weight || 1) * 0.5, 2);
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
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + SELECTED_RING, 0, Math.PI * 2);
      ctx.strokeStyle = SELECT_RING;
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (isHovered && !isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = INK_2;
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    if (node.radius > 10 || isSelected || isHovered || (isConnected && selectedEntity)) {
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dimmed ? INK_3 : INK_0;
      ctx.fillText(node.name, node.x, node.y + node.radius + 4);
    }
  }
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
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);

  const eventById = useMemo(() => {
    const map = new Map();
    for (const e of events) map.set(e.id, e);
    return map;
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

  // Build + run simulation when data / size changes
  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      simRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d').clearRect(0, 0, width, height);
      return undefined;
    }

    const sim = initSimulation(nodes, edges, width, height);
    simRef.current = sim;
    alphaRef.current = 1;

    // Pre-warm: iterate synchronously so first paint is already spread out
    for (let i = 0; i < PREWARM_TICKS; i++) {
      tickSimulation(sim.simNodes, sim.simEdges, width, height, alphaRef.current);
      alphaRef.current *= 0.985;
    }

    let running = true;
    const animate = () => {
      if (!running || !simRef.current) return;
      const { simNodes, simEdges } = simRef.current;

      if (alphaRef.current > 0.02) {
        tickSimulation(simNodes, simEdges, width, height, alphaRef.current);
        alphaRef.current *= 0.985;
      }

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredRef.current, width, height);
      }
      animRef.current = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      running = false;
      if (animRef.current) cancelAnimationFrame(animRef.current);
    };
    // selectedEntity intentionally omitted — it's consumed in the second effect
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nodes, edges, width, height]);

  // Redraw on selection / hover changes without restarting sim
  useEffect(() => {
    hoveredRef.current = hoveredEntity;
    if (simRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      const { simNodes, simEdges } = simRef.current;
      drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, width, height);
    }
  }, [selectedEntity, hoveredEntity, width, height]);

  const findNodeAt = useCallback((clientX, clientY) => {
    if (!canvasRef.current || !simRef.current) return null;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    const { simNodes } = simRef.current;
    for (let i = simNodes.length - 1; i >= 0; i--) {
      const node = simNodes[i];
      const dx = node.x - x;
      const dy = node.y - y;
      const hit = node.radius + 4;
      if (dx * dx + dy * dy <= hit * hit) return node;
    }
    return null;
  }, []);

  const handleClick = useCallback((e) => {
    const node = findNodeAt(e.clientX, e.clientY);
    if (node) {
      onEntitySelect?.(node.id === selectedEntity ? null : node.id);
    } else {
      onEntitySelect?.(null);
    }
  }, [findNodeAt, onEntitySelect, selectedEntity]);

  const handleMouseMove = useCallback((e) => {
    const node = findNodeAt(e.clientX, e.clientY);
    const id = node ? node.id : null;
    if (id !== hoveredRef.current) {
      setHoveredEntity(id);
    }
    if (node && wrapperRef.current) {
      const rect = wrapperRef.current.getBoundingClientRect();
      setTooltipPos({
        x: e.clientX - rect.left + 12,
        y: e.clientY - rect.top - 8,
      });
    } else {
      setTooltipPos(null);
    }
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? 'pointer' : 'default';
    }
  }, [findNodeAt]);

  const handleMouseLeave = useCallback(() => {
    setHoveredEntity(null);
    setTooltipPos(null);
  }, []);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        className="entity-graph-canvas"
        width={width}
        height={height}
        onClick={handleClick}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        role="img"
        aria-label="Entity relationship graph"
      />
      {tooltipData && tooltipPos && (
        <div
          className="entity-tooltip"
          style={{ left: tooltipPos.x, top: tooltipPos.y }}
        >
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
