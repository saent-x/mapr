/**
 * Force-directed graph physics — extracted so a Web Worker can run the
 * heavy `PREWARM_TICKS × O(n²)` loop off the main thread. The component
 * imports the same functions for in-flight ticks during animation.
 *
 * Pure data-in / data-out: no DOM, no canvas, no React.
 */

export const PREWARM_TICKS = 360;

const MIN_NODE_RADIUS = 9;
const MAX_NODE_RADIUS = 18;
const ALPHA_FLOOR = 0.14;
const ALPHA_DECAY = 0.992;
const COLLIDE_ITERATIONS = 4;
const COLLIDE_PADDING_BASE = 34;
const COLLIDE_PER_DEGREE = 6;
const COLLIDE_PADDING_MAX = 80;

function nodeRadius(mentionCount, maxMentions) {
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

export function initSimulation(nodes, edges, worldW, worldH) {
  const maxMentions = Math.max(1, ...nodes.map((n) => n.mentionCount || 1));
  const cx = worldW / 2;
  const cy = worldH / 2;
  const spreadR = Math.min(worldW, worldH) * 0.42;

  const degree = new Map();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) || 0) + 1);
    degree.set(e.target, (degree.get(e.target) || 0) + 1);
  }

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

export function tickSimulation(simNodes, simEdges, worldW, worldH, alpha, selectedId, connectedSet) {
  const k = alpha;
  const BOUND_PAD = 40;
  const hasSelection = !!selectedId;
  const cx = worldW / 2;
  const cy = worldH / 2;

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

  for (const node of simNodes) {
    if (node.fixed) continue;
    node.vx += (cx - node.x) * 0.00035 * k;
    node.vy += (cy - node.y) * 0.00035 * k;
  }

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

  for (const node of simNodes) {
    if (node.fixed) continue;
    node.vx += (Math.random() - 0.5) * 0.4 * k;
    node.vy += (Math.random() - 0.5) * 0.4 * k;
  }

  for (const node of simNodes) {
    if (node.fixed) continue;
    const r = node.radius;
    const leftP = (r + BOUND_PAD) - node.x;
    const rightP = node.x - (worldW - r - BOUND_PAD);
    const topP = (r + BOUND_PAD) - node.y;
    const botP = node.y - (worldH - r - BOUND_PAD);
    if (leftP > 0) node.vx += leftP * 0.02;
    if (rightP > 0) node.vx -= rightP * 0.02;
    if (topP > 0) node.vy += topP * 0.02;
    if (botP > 0) node.vy -= botP * 0.02;
  }

  for (const node of simNodes) {
    if (node.fixed) { node.vx = 0; node.vy = 0; continue; }
    node.vx *= 0.88;
    node.vy *= 0.88;
    node.x += node.vx;
    node.y += node.vy;
  }

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

/**
 * Run a full prewarm sequence and return only the bare per-node positions.
 * Used by the worker so we don't transfer object cycles (sourceNode/targetNode
 * back-refs) over the message-channel.
 */
export function prewarmAndExtract(nodes, edges, worldW, worldH, ticks = PREWARM_TICKS) {
  const sim = initSimulation(nodes, edges, worldW, worldH);
  let alpha = 1;
  for (let i = 0; i < ticks; i++) {
    tickSimulation(sim.simNodes, sim.simEdges, worldW, worldH, alpha, null, new Set());
    alpha = Math.max(ALPHA_FLOOR, alpha * ALPHA_DECAY);
  }
  return {
    positions: sim.simNodes.map((n) => ({
      id: n.id,
      x: n.x,
      y: n.y,
      vx: n.vx,
      vy: n.vy,
      radius: n.radius,
      degree: n.degree,
      pad: n.pad,
    })),
    finalAlpha: alpha,
  };
}
