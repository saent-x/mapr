import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Force-directed entity relationship graph on HTML5 Canvas.
 *
 * Visual language (matches Mapr Console tactical spec):
 * - Nodes are outlined rings with an inner type glyph: ■ org / ◆ loc / P
 *   person. Selected + connected nodes render as solid filled discs.
 * - Edges are thin, very low-opacity lines; highlighted edges use amber.
 * - Faint dot-grid background (screen-space) for a tactical map feel.
 *
 * Interaction:
 * - Drag a node to reposition it (sticky while held).
 * - Drag empty canvas to pan.
 * - Wheel to zoom (cursor-anchored).
 * - Click node to select / deselect. Selection re-clusters connected
 *   neighbours around the selected node; non-connected nodes drift away.
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
const GRID_DOT = 'rgba(232, 230, 223, 0.055)';
const EDGE_BASE = 'rgba(140, 146, 160, 0.18)';
const EDGE_DIM  = 'rgba(140, 146, 160, 0.08)';
const EDGE_HIGH = 'rgba(232, 163, 61, 0.85)';

const MIN_NODE_RADIUS = 9;
const MAX_NODE_RADIUS = 18;
const LABEL_FONT = '11px "IBM Plex Mono", ui-monospace, Menlo, monospace';
const GLYPH_FONT_WEIGHT = '500';

const PREWARM_TICKS = 360;
const WORLD_SCALE = 2.8;
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 3.0;
const ZOOM_STEP = 1.06;
const DRAG_THRESHOLD = 4;

const ALPHA_FLOOR = 0.14;
const ALPHA_DECAY = 0.992;
const REHEAT_ALPHA = 0.75;

const COLLIDE_ITERATIONS = 4;
const COLLIDE_PADDING_BASE = 34;
const COLLIDE_PER_DEGREE  = 6;
const COLLIDE_PADDING_MAX = 80;

const GRID_SPACING = 22;
const GRID_DOT_RADIUS = 1;

function nodeRadius(mentionCount, maxMentions) {
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function initSimulation(nodes, edges, worldW, worldH) {
  const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount || 1));
  const cx = worldW / 2;
  const cy = worldH / 2;
  const spreadR = Math.min(worldW, worldH) * 0.42;

  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

  // Scatter start: random positions across a disc around world centre.
  // No type zones — physics alone determines final layout.
  const simNodes = nodes.map((n) => {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.sqrt(Math.random()) * spreadR;
    const deg = degree.get(n.id) || 0;
    return {
      ...n,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
      vx: 0,
      vy: 0,
      radius: nodeRadius(n.mentionCount, maxMentions),
      degree: deg,
      pad: Math.min(COLLIDE_PADDING_MAX, COLLIDE_PADDING_BASE + deg * COLLIDE_PER_DEGREE),
      fixed: false,
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
  const cx = worldW / 2;
  const cy = worldH / 2;

  // 1. Pairwise Coulomb repulsion
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const minSep = a.radius + b.radius + Math.max(a.pad, b.pad);
      const charge = dist < minSep ? 5800 : 2400;
      const force = (charge * k) / (dist * dist);
      const ux = dx / dist;
      const uy = dy / dist;
      if (!a.fixed) { a.vx -= ux * force; a.vy -= uy * force; }
      if (!b.fixed) { b.vx += ux * force; b.vy += uy * force; }
    }
  }

  // 2. Edge springs — weighted. Heavier bonds sit closer; weak co-occurrence
  //    stays loose. Gives variable spacing between connected pairs.
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const involvesSelected = hasSelection && (edge.source === selectedId || edge.target === selectedId);
    const w = Math.min(edge.weight || 1, 5);
    const idealDist = involvesSelected ? 110 : (260 - w * 18);
    const stiffness = involvesSelected ? 0.0065 : 0.0038;
    const force = (dist - idealDist) * stiffness * k * w;
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    if (!a.fixed) { a.vx += fx; a.vy += fy; }
    if (!b.fixed) { b.vx -= fx; b.vy -= fy; }
  }

  // 3. Very weak centre gravity — keeps the cloud bounded without clumping
  for (const node of simNodes) {
    if (node.fixed) continue;
    node.vx += (cx - node.x) * 0.00035 * k;
    node.vy += (cy - node.y) * 0.00035 * k;
  }

  // 4. Isolated nodes (degree 0) drift toward an outer orbit
  for (const node of simNodes) {
    if (node.fixed || node.degree !== 0) continue;
    const dx = node.x - cx;
    const dy = node.y - cy;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const target = Math.min(worldW, worldH) * 0.42;
    const push = (target - dist) * 0.003 * k;
    node.vx += (dx / dist) * push;
    node.vy += (dy / dist) * push;
  }

  // 5. Selection: non-connected nodes pushed out of a 320px halo.
  // Skip once sim has cooled below 0.2 — positions are stable, O(n) loop is
  // pure waste. Also no-op when there's no selection (hasSelection gate).
  if (hasSelection && k >= 0.2) {
    const sel = simNodes.find((n) => n.id === selectedId);
    if (sel) {
      for (const node of simNodes) {
        if (node.id === selectedId || connectedSet.has(node.id) || node.fixed) continue;
        const dx = node.x - sel.x;
        const dy = node.y - sel.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 1;
        if (dist < 320) {
          const push = (320 - dist) * 0.02 * k;
          node.vx += (dx / dist) * push;
          node.vy += (dy / dist) * push;
        }
      }
    }
  }

  // 6. Thermal jitter
  for (const node of simNodes) {
    if (node.fixed) continue;
    node.vx += (Math.random() - 0.5) * 0.4 * k;
    node.vy += (Math.random() - 0.5) * 0.4 * k;
  }

  // 7. Soft bounds
  for (const node of simNodes) {
    if (node.fixed) continue;
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

  // 8. Integrate with damping (fixed nodes don't move)
  for (const node of simNodes) {
    if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
    node.vx *= 0.88;
    node.vy *= 0.88;
    node.x += node.vx;
    node.y += node.vy;
  }

  // 9. Iterative collision resolution
  for (let it = 0; it < COLLIDE_ITERATIONS; it++) {
    for (let i = 0; i < simNodes.length; i++) {
      for (let j = i + 1; j < simNodes.length; j++) {
        const a = simNodes[i];
        const b = simNodes[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const minD = a.radius + b.radius + Math.max(a.pad, b.pad) * 0.55;
        if (dist < minD) {
          const overlap = (minD - dist);
          const ux = dx / dist;
          const uy = dy / dist;
          // Fixed nodes don't get pushed
          if (a.fixed && b.fixed) continue;
          if (a.fixed) {
            b.x += ux * overlap;
            b.y += uy * overlap;
          } else if (b.fixed) {
            a.x -= ux * overlap;
            a.y -= uy * overlap;
          } else {
            a.x -= ux * overlap * 0.5;
            a.y -= uy * overlap * 0.5;
            b.x += ux * overlap * 0.5;
            b.y += uy * overlap * 0.5;
          }
        }
      }
    }
  }
}

function drawDotGrid(ctx, width, height) {
  ctx.fillStyle = GRID_DOT;
  for (let y = GRID_SPACING / 2; y < height; y += GRID_SPACING) {
    for (let x = GRID_SPACING / 2; x < width; x += GRID_SPACING) {
      ctx.beginPath();
      ctx.arc(x, y, GRID_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

function drawNodeGlyph(ctx, node, color, isActive, view) {
  const r = node.radius;
  const g = r * 0.52;
  if (node.type === 'organization') {
    ctx.fillStyle = isActive ? '#0f1115' : color;
    ctx.fillRect(node.x - g / 2, node.y - g / 2, g, g);
  } else if (node.type === 'location') {
    ctx.fillStyle = isActive ? '#0f1115' : color;
    ctx.beginPath();
    ctx.moveTo(node.x, node.y - g * 0.8);
    ctx.lineTo(node.x + g * 0.8, node.y);
    ctx.lineTo(node.x, node.y + g * 0.8);
    ctx.lineTo(node.x - g * 0.8, node.y);
    ctx.closePath();
    ctx.fill();
  } else if (node.type === 'person') {
    // Render P in screen space for crisp glyph at any zoom
    const sx = node.x * view.scale + view.tx;
    const sy = node.y * view.scale + view.ty;
    const fontPx = Math.max(9, Math.round(r * view.scale * 0.95));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.font = `${GLYPH_FONT_WEIGHT} ${fontPx}px "IBM Plex Mono", ui-monospace, Menlo, monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = isActive ? '#0f1115' : color;
    ctx.fillText('P', sx, sy);
    ctx.restore();
  }
}

function drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, viewport, view, worldW, worldH) {
  const { width, height } = viewport;
  ctx.clearRect(0, 0, width, height);

  // 1. Dot grid in screen space
  drawDotGrid(ctx, width, height);

  // 2. World transform for graph content
  ctx.save();
  ctx.translate(view.tx, view.ty);
  ctx.scale(view.scale, view.scale);

  const connectedIds = new Set();
  if (selectedEntity) {
    connectedIds.add(selectedEntity);
    for (const edge of simEdges) {
      if (edge.source === selectedEntity) connectedIds.add(edge.target);
      if (edge.target === selectedEntity) connectedIds.add(edge.source);
    }
  }

  // 3. Edges
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const isHighlighted = selectedEntity
      ? connectedIds.has(edge.source) && connectedIds.has(edge.target)
      : false;
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    if (isHighlighted) {
      ctx.strokeStyle = EDGE_HIGH;
      ctx.lineWidth = 1.4 / view.scale;
    } else {
      ctx.strokeStyle = selectedEntity ? EDGE_DIM : EDGE_BASE;
      ctx.lineWidth = 0.8 / view.scale;
    }
    ctx.stroke();
  }

  // 4. Nodes — outlined rings with inner glyph, solid disc when active
  for (const node of simNodes) {
    const isSelected = node.id === selectedEntity;
    const isHovered  = node.id === hoveredEntity;
    const isConnected = connectedIds.has(node.id);
    const isActive = isSelected || isConnected;
    const dimmed = selectedEntity && !isActive;
    const color = TYPE_COLORS[node.type] || '#999';

    ctx.beginPath();
    ctx.arc(node.x, node.y, node.radius, 0, Math.PI * 2);
    if (isActive) {
      ctx.fillStyle = color;
      ctx.fill();
    } else {
      ctx.fillStyle = '#0f1115';
      ctx.fill();
      ctx.strokeStyle = dimmed ? `${color}55` : color;
      ctx.lineWidth = 1.3 / view.scale;
      ctx.stroke();
    }

    drawNodeGlyph(ctx, node, color, isActive, view);

    if (isSelected) {
      // Outer halo ring
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 5, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(232, 163, 61, 0.35)';
      ctx.lineWidth = 1 / view.scale;
      ctx.stroke();
    } else if (isHovered) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = INK_2;
      ctx.lineWidth = 1 / view.scale;
      ctx.stroke();
    }
  }

  ctx.restore();

  // 5. Labels in screen space (crisp at any zoom)
  for (const node of simNodes) {
    const isSelected = node.id === selectedEntity;
    const isHovered  = node.id === hoveredEntity;
    const isConnected = connectedIds.has(node.id);
    const dimmed = selectedEntity && !(isSelected || isConnected);
    const sx = node.x * view.scale + view.tx;
    const sy = (node.y + node.radius) * view.scale + view.ty + 6;
    ctx.font = LABEL_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = dimmed ? INK_3 : (isSelected || isHovered ? INK_0 : 'rgba(232, 230, 223, 0.7)');
    ctx.fillText(node.name, sx, sy);
  }
}

function clampView(view, viewport, worldW, worldH) {
  const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.scale));
  const { width, height } = viewport;
  const slackPad = 180;
  const worldPxW = worldW * scale;
  const worldPxH = worldH * scale;
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
  const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(sx, sy) * 1.05));
  const tx = (viewport.width  - worldW * scale) / 2;
  const ty = (viewport.height - worldH * scale) / 2;
  return { scale, tx, ty };
}

/* Fit view to the actual node cluster plus padding — much better than
   fitting the empty world, which produces tiny nodes in the centre. */
function fitViewToNodes(simNodes, viewport, margin = 80) {
  if (!simNodes || simNodes.length === 0) return { scale: 1, tx: 0, ty: 0 };
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of simNodes) {
    const r = (n.radius || 0) + 16; // include label space
    if (n.x - r < minX) minX = n.x - r;
    if (n.y - r < minY) minY = n.y - r;
    if (n.x + r > maxX) maxX = n.x + r;
    if (n.y + r > maxY) maxY = n.y + r;
  }
  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const sx = (viewport.width  - margin * 2) / w;
  const sy = (viewport.height - margin * 2) / h;
  const scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, Math.min(sx, sy)));
  const tx = (viewport.width  - (minX + maxX) * scale) / 2;
  const ty = (viewport.height - (minY + maxY) * scale) / 2;
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
  const dragRef = useRef(null); // { kind: 'pan' | 'node', ... }

  const [hoveredEntity, setHoveredEntity] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);
  const [zoomDisplay, setZoomDisplay] = useState(1);

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
    alphaRef.current = Math.max(alphaRef.current, REHEAT_ALPHA);
  }, [selectedEntity]);

  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      simRef.current = null;
      const canvas = canvasRef.current;
      if (canvas) canvas.getContext('2d').clearRect(0, 0, width, height);
      return undefined;
    }

    // Identity signature of node set — reinit only when set actually changes.
    // Upstream useMemo churn produces new {nodes,edges} refs on every refresh;
    // without this check the sim re-scatters + prewarms 360 ticks each time.
    const newIdSig = nodes.map((n) => n.id).sort().join('|');
    const existing = simRef.current;
    const sameStructure = existing
      && existing.idSig === newIdSig
      && existing.worldW === worldW
      && existing.worldH === worldH;

    let sim;
    if (sameStructure) {
      // In-place update: preserve x/y/vx/vy/fixed per node, rebuild edges,
      // refresh radius/degree/pad from incoming data. No prewarm, no fitView.
      const existingById = new Map(existing.simNodes.map((n) => [n.id, n]));
      const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount || 1));
      const degree = new Map();
      for (const e of edges) {
        degree.set(e.source, (degree.get(e.source) || 0) + 1);
        degree.set(e.target, (degree.get(e.target) || 0) + 1);
      }
      const simNodes = nodes.map((n) => {
        const prev = existingById.get(n.id);
        const deg = degree.get(n.id) || 0;
        return {
          ...n,
          x: prev.x,
          y: prev.y,
          vx: prev.vx,
          vy: prev.vy,
          fixed: prev.fixed,
          radius: nodeRadius(n.mentionCount, maxMentions),
          degree: deg,
          pad: Math.min(COLLIDE_PADDING_MAX, COLLIDE_PADDING_BASE + deg * COLLIDE_PER_DEGREE),
        };
      });
      const nodeIndex = new Map(simNodes.map((n) => [n.id, n]));
      const simEdges = edges
        .map((e) => ({ ...e, sourceNode: nodeIndex.get(e.source), targetNode: nodeIndex.get(e.target) }))
        .filter((e) => e.sourceNode && e.targetNode);
      sim = { simNodes, simEdges, nodeIndex, idSig: newIdSig, worldW, worldH };
      simRef.current = sim;
      // Mild reheat so new/removed edges can relax without a full re-scatter.
      alphaRef.current = Math.max(alphaRef.current, 0.35);
    } else {
      sim = initSimulation(nodes, edges, worldW, worldH);
      sim.idSig = newIdSig;
      sim.worldW = worldW;
      sim.worldH = worldH;
      simRef.current = sim;
      alphaRef.current = 1;

      for (let i = 0; i < PREWARM_TICKS; i++) {
        tickSimulation(sim.simNodes, sim.simEdges, worldW, worldH, alphaRef.current, null, connectedRef.current);
        alphaRef.current = Math.max(ALPHA_FLOOR, alphaRef.current * ALPHA_DECAY);
      }

      viewRef.current = fitViewToNodes(sim.simNodes, { width, height });
      setZoomDisplay(viewRef.current.scale);
    }

    let running = true;
    const animate = () => {
      if (!running || !simRef.current) return;
      const { simNodes, simEdges } = simRef.current;
      tickSimulation(simNodes, simEdges, worldW, worldH, alphaRef.current, selectedRef.current, connectedRef.current);
      alphaRef.current = Math.max(ALPHA_FLOOR, alphaRef.current * ALPHA_DECAY);

      const canvas = canvasRef.current;
      if (canvas) {
        const ctx = canvas.getContext('2d');
        drawGraph(ctx, simNodes, simEdges, selectedRef.current, hoveredRef.current,
          { width, height }, viewRef.current, worldW, worldH);
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
      const hit = node.radius + 5;
      if (dx * dx + dy * dy <= hit * hit) return node;
    }
    return null;
  }, [screenToWorld]);

  const handlePointerDown = useCallback((e) => {
    if (e.button !== 0) return;
    // Pointer capture: all subsequent pointermove/up route to canvas even
    // when cursor leaves it. Fixes "drop outside canvas pins node forever".
    try { e.currentTarget.setPointerCapture(e.pointerId); } catch {}
    const node = findNodeAt(e.clientX, e.clientY);
    if (node) {
      node.fixed = true;
      node.vx = 0;
      node.vy = 0;
      dragRef.current = {
        kind: 'node',
        node,
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
      };
      alphaRef.current = Math.max(alphaRef.current, 0.5);
    } else {
      dragRef.current = {
        kind: 'pan',
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        moved: false,
        startView: { ...viewRef.current },
      };
    }
  }, [findNodeAt]);

  const handlePointerMove = useCallback((e) => {
    const d = dragRef.current;
    if (d) {
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      if (!d.moved && (Math.abs(dx) > DRAG_THRESHOLD || Math.abs(dy) > DRAG_THRESHOLD)) {
        d.moved = true;
        setTooltipPos(null);
        setHoveredEntity(null);
        hoveredRef.current = null;
        if (canvasRef.current) {
          canvasRef.current.style.cursor = d.kind === 'node' ? 'grabbing' : 'grabbing';
        }
      }
      if (d.moved) {
        if (d.kind === 'node') {
          const scale = viewRef.current.scale;
          d.node.x += (e.clientX - (d.lastX ?? d.startX)) / scale;
          d.node.y += (e.clientY - (d.lastY ?? d.startY)) / scale;
          d.lastX = e.clientX;
          d.lastY = e.clientY;
        } else {
          viewRef.current = clampView(
            { scale: d.startView.scale, tx: d.startView.tx + dx, ty: d.startView.ty + dy },
            { width, height }, worldW, worldH,
          );
        }
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
      canvasRef.current.style.cursor = node ? 'grab' : 'default';
    }
  }, [findNodeAt, width, height, worldW, worldH]);

  const handlePointerUp = useCallback((e) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    if (!d) return;
    if (d.kind === 'node') {
      // Release node back to sim (unpin) unless user wants sticky —
      // unpin is the expected "nudge it then let physics take over" feel.
      d.node.fixed = false;
      if (!d.moved) {
        onEntitySelect?.(d.node.id === selectedEntity ? null : d.node.id);
        alphaRef.current = REHEAT_ALPHA;
      }
    } else if (d.kind === 'pan' && !d.moved) {
      onEntitySelect?.(null);
    }
  }, [onEntitySelect, selectedEntity]);

  const handlePointerLeave = useCallback(() => {
    // With pointer capture the drag keeps routing events here even when
    // cursor leaves canvas — don't tear down drag state on leave. Just
    // clear hover UI.
    if (dragRef.current) return;
    hoveredRef.current = null;
    setHoveredEntity(null);
    setTooltipPos(null);
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
  }, []);

  const handlePointerCancel = useCallback((e) => {
    // Browser/OS cancelled the pointer (e.g. gesture hijack). Unpin and
    // clear drag so the node doesn't stay stuck.
    const d = dragRef.current;
    dragRef.current = null;
    if (canvasRef.current) canvasRef.current.style.cursor = 'default';
    try { e.currentTarget.releasePointerCapture?.(e.pointerId); } catch {}
    if (d && d.kind === 'node' && d.node) d.node.fixed = false;
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
    setZoomDisplay(newScale);
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
    setZoomDisplay(newScale);
  }, [width, height, worldW, worldH]);

  const resetView = useCallback(() => {
    if (simRef.current) {
      viewRef.current = fitViewToNodes(simRef.current.simNodes, { width, height });
    } else {
      viewRef.current = fitView({ width, height }, worldW, worldH);
    }
    alphaRef.current = Math.max(alphaRef.current, REHEAT_ALPHA);
    setZoomDisplay(viewRef.current.scale);
  }, [width, height, worldW, worldH]);

  return (
    <div ref={wrapperRef} style={{ position: 'relative', width, height }}>
      <canvas
        ref={canvasRef}
        className="entity-graph-canvas"
        width={width}
        height={height}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerLeave={handlePointerLeave}
        onPointerCancel={handlePointerCancel}
        style={{ touchAction: 'none' }}
        role="img"
        aria-label="Entity relationship graph"
      />
      <div className="entity-graph-status">
        ZOOM · {zoomDisplay.toFixed(2)}× · DRAG NODES
      </div>
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
