import React, { useRef, useEffect, useCallback, useState, useMemo } from 'react';

/**
 * Force-directed entity relationship graph rendered on HTML5 Canvas.
 *
 * Props:
 *  - nodes: Array<{ name, type, mentionCount, eventIds }>
 *  - edges: Array<{ source, target, weight, sharedEventIds }>
 *  - selectedEntity: string | null
 *  - onEntitySelect: (entityName: string | null) => void
 *  - width: number
 *  - height: number
 */

/* ── Layout constants ── */
const TYPE_COLORS = {
  person: '#e8a838',
  organization: '#4fc3f7',
  location: '#66bb6a',
};

const MIN_NODE_RADIUS = 6;
const MAX_NODE_RADIUS = 24;
const LABEL_FONT = '11px -apple-system, BlinkMacSystemFont, sans-serif';
const SELECTED_RING = 3;

/* ── Simple force simulation ── */

function initSimulation(nodes, edges, width, height) {
  // Place nodes randomly in center area
  const simNodes = nodes.map((n, i) => ({
    ...n,
    x: width / 2 + (Math.random() - 0.5) * width * 0.6,
    y: height / 2 + (Math.random() - 0.5) * height * 0.6,
    vx: 0,
    vy: 0,
    radius: nodeRadius(n.mentionCount, nodes),
  }));

  // Index nodes by their typed id (e.g. "person:antonio guterres")
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

function nodeRadius(mentionCount, allNodes) {
  if (!allNodes || allNodes.length === 0) return MIN_NODE_RADIUS;
  const maxMentions = Math.max(...allNodes.map((n) => n.mentionCount || 1));
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_NODE_RADIUS + ratio * (MAX_NODE_RADIUS - MIN_NODE_RADIUS);
}

function tickSimulation(simNodes, simEdges, width, height, alpha) {
  const k = alpha;

  // 1. Repulsion (all pairs, O(n²) — fine for < 500 nodes)
  for (let i = 0; i < simNodes.length; i++) {
    for (let j = i + 1; j < simNodes.length; j++) {
      const a = simNodes[i];
      const b = simNodes[j];
      let dx = b.x - a.x;
      let dy = b.y - a.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 1;
      const force = (200 * k) / (dist * dist);
      dx *= force / dist;
      dy *= force / dist;
      a.vx -= dx;
      a.vy -= dy;
      b.vx += dx;
      b.vy += dy;
    }
  }

  // 2. Attraction along edges (spring)
  for (const edge of simEdges) {
    const a = edge.sourceNode;
    const b = edge.targetNode;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    const idealDist = 100;
    const force = (dist - idealDist) * 0.005 * k * Math.min(edge.weight, 5);
    const fx = (dx / dist) * force;
    const fy = (dy / dist) * force;
    a.vx += fx;
    a.vy += fy;
    b.vx -= fx;
    b.vy -= fy;
  }

  // 3. Center gravity
  for (const node of simNodes) {
    node.vx += (width / 2 - node.x) * 0.001 * k;
    node.vy += (height / 2 - node.y) * 0.001 * k;
  }

  // 4. Apply velocities with damping
  for (const node of simNodes) {
    node.vx *= 0.85;
    node.vy *= 0.85;
    node.x += node.vx;
    node.y += node.vy;
    // Keep within bounds
    const r = node.radius;
    node.x = Math.max(r, Math.min(width - r, node.x));
    node.y = Math.max(r, Math.min(height - r, node.y));
  }
}

/* ── Canvas rendering ── */

function drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, width, height) {
  ctx.clearRect(0, 0, width, height);

  // Build connected set for selection highlighting (using typed ids)
  const connectedIds = new Set();
  if (selectedEntity) {
    connectedIds.add(selectedEntity);
    for (const edge of simEdges) {
      if (edge.source === selectedEntity) connectedIds.add(edge.target);
      if (edge.target === selectedEntity) connectedIds.add(edge.source);
    }
  }

  // Draw edges
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
      ? 'rgba(255,255,255,0.5)'
      : selectedEntity
        ? 'rgba(255,255,255,0.06)'
        : 'rgba(255,255,255,0.12)';
    ctx.lineWidth = isHighlighted ? Math.min(edge.weight, 4) : Math.min(edge.weight * 0.5, 2);
    ctx.stroke();
  }

  // Draw nodes
  for (const node of simNodes) {
    const isSelected = node.id === selectedEntity;
    const isHovered = node.id === hoveredEntity;
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
      ctx.strokeStyle = '#fff';
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    if (isHovered && !isSelected) {
      ctx.beginPath();
      ctx.arc(node.x, node.y, node.radius + 2, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1;
      ctx.stroke();
    }

    // Label (show for larger nodes, selected, hovered, or connected)
    if (node.radius > 10 || isSelected || isHovered || (isConnected && selectedEntity)) {
      ctx.font = LABEL_FONT;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillStyle = dimmed ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.85)';
      ctx.fillText(node.name, node.x, node.y + node.radius + 4);
    }
  }
}

/* ── React component ── */

export default function EntityRelationshipGraph({
  nodes,
  edges,
  selectedEntity,
  onEntitySelect,
  width = 800,
  height = 600,
}) {
  const canvasRef = useRef(null);
  const simRef = useRef(null);
  const animRef = useRef(null);
  const alphaRef = useRef(1);
  const [hoveredEntity, setHoveredEntity] = useState(null);
  const hoveredRef = useRef(null);

  // Initialize simulation when nodes/edges change
  useEffect(() => {
    if (!nodes || nodes.length === 0) {
      simRef.current = null;
      return;
    }

    const sim = initSimulation(nodes, edges, width, height);
    simRef.current = sim;
    alphaRef.current = 1;

    // Run simulation ticks
    let running = true;
    const animate = () => {
      if (!running || !simRef.current) return;
      const { simNodes, simEdges } = simRef.current;

      if (alphaRef.current > 0.01) {
        tickSimulation(simNodes, simEdges, width, height, alphaRef.current);
        alphaRef.current *= 0.98;
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
  }, [nodes, edges, width, height, selectedEntity]);

  // Redraw on selection / hover changes (without restarting simulation)
  useEffect(() => {
    hoveredRef.current = hoveredEntity;
    if (simRef.current && canvasRef.current) {
      const ctx = canvasRef.current.getContext('2d');
      const { simNodes, simEdges } = simRef.current;
      drawGraph(ctx, simNodes, simEdges, selectedEntity, hoveredEntity, width, height);
    }
  }, [selectedEntity, hoveredEntity, width, height]);

  // Hit testing
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
      if (dx * dx + dy * dy <= (node.radius + 4) * (node.radius + 4)) {
        return node;
      }
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
    if (canvasRef.current) {
      canvasRef.current.style.cursor = node ? 'pointer' : 'default';
    }
  }, [findNodeAt]);

  return (
    <canvas
      ref={canvasRef}
      className="entity-graph-canvas"
      width={width}
      height={height}
      onClick={handleClick}
      onMouseMove={handleMouseMove}
      onMouseLeave={() => setHoveredEntity(null)}
      role="img"
      aria-label="Entity relationship graph"
    />
  );
}
