import React, { useMemo, useRef, useState } from 'react';

/**
 * Radial (chord-like) entity relationship graph rendered in SVG.
 *
 * Replaces the previous canvas force-sim, which became unreadable with
 * more than a handful of nodes. Nodes are laid out on a circle, grouped
 * by type (person / organization / location), sized by mention count.
 * Edges are drawn as cubic Bézier chords through the centre, so even
 * dense graphs stay legible.
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
const TYPE_ORDER = ['organization', 'location', 'person'];

const EDGE_BASE = 'rgba(50, 56, 70, 0.55)';
const EDGE_DIM  = 'rgba(38, 43, 53, 0.25)';
const EDGE_HIGH = 'rgba(232, 163, 61, 0.7)';
const INK_0 = '#e8e6df';
const INK_2 = 'rgba(232, 230, 223, 0.55)';
const INK_3 = 'rgba(232, 230, 223, 0.28)';

const MIN_R = 3.5;
const MAX_R = 9;
const LABEL_GAP = 10;
const MAX_NODES = 60;

function nodeRadius(mentionCount, maxMentions) {
  const ratio = (mentionCount || 1) / (maxMentions || 1);
  return MIN_R + ratio * (MAX_R - MIN_R);
}

function polar(cx, cy, r, theta) {
  return { x: cx + r * Math.cos(theta), y: cy + r * Math.sin(theta) };
}

function buildLayout(nodes, width, height) {
  const sorted = [...nodes]
    .sort((a, b) => {
      const ta = TYPE_ORDER.indexOf(a.type);
      const tb = TYPE_ORDER.indexOf(b.type);
      if (ta !== tb) return ta - tb;
      return (b.mentionCount || 0) - (a.mentionCount || 0);
    })
    .slice(0, MAX_NODES);

  const maxMentions = Math.max(1, ...sorted.map((n) => n.mentionCount || 1));
  const n = Math.max(sorted.length, 1);
  const cx = width / 2;
  const cy = height / 2;
  const radius = Math.max(60, Math.min(width, height) / 2 - 100);

  const positioned = sorted.map((node, i) => {
    // Distribute around a full circle; start at top.
    const theta = (i / n) * Math.PI * 2 - Math.PI / 2;
    const { x, y } = polar(cx, cy, radius, theta);
    return {
      ...node,
      x,
      y,
      theta,
      radius: nodeRadius(node.mentionCount, maxMentions),
    };
  });

  return { positioned, cx, cy, radius };
}

function chordPath(a, b, cx, cy) {
  // Cubic Bézier with control points pulled toward centre — produces a
  // clean arc that hugs the inside of the node circle.
  const cp1x = cx + (a.x - cx) * 0.15;
  const cp1y = cy + (a.y - cy) * 0.15;
  const cp2x = cx + (b.x - cx) * 0.15;
  const cp2y = cy + (b.y - cy) * 0.15;
  return `M ${a.x} ${a.y} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${b.x} ${b.y}`;
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
  const wrapperRef = useRef(null);
  const [hoveredId, setHoveredId] = useState(null);
  const [tooltipPos, setTooltipPos] = useState(null);

  const { positioned, cx, cy, radius } = useMemo(
    () => buildLayout(nodes, width, height),
    [nodes, width, height],
  );

  const nodeIndex = useMemo(() => {
    const m = new Map();
    for (const n of positioned) m.set(n.id, n);
    return m;
  }, [positioned]);

  // Only keep edges whose endpoints survived the top-N slice.
  const visibleEdges = useMemo(
    () => edges.filter((e) => nodeIndex.has(e.source) && nodeIndex.has(e.target)),
    [edges, nodeIndex],
  );

  const connectedIds = useMemo(() => {
    if (!selectedEntity) return new Set();
    const s = new Set([selectedEntity]);
    for (const e of visibleEdges) {
      if (e.source === selectedEntity) s.add(e.target);
      if (e.target === selectedEntity) s.add(e.source);
    }
    return s;
  }, [visibleEdges, selectedEntity]);

  const eventById = useMemo(() => {
    const m = new Map();
    for (const e of events) m.set(e.id, e);
    return m;
  }, [events]);

  const hoveredNode = hoveredId ? nodeIndex.get(hoveredId) : null;
  const tooltipData = useMemo(() => {
    if (!hoveredNode) return null;
    const connectionCount = visibleEdges.filter(
      (e) => e.source === hoveredNode.id || e.target === hoveredNode.id,
    ).length;
    const eventTitles = (hoveredNode.eventIds || [])
      .slice(0, 3)
      .map((eid) => eventById.get(eid)?.title)
      .filter(Boolean);
    return {
      name: hoveredNode.name,
      type: TYPE_LABELS[hoveredNode.type] || hoveredNode.type,
      color: TYPE_COLORS[hoveredNode.type] || '#999',
      mentions: hoveredNode.mentionCount || 0,
      connections: connectionCount,
      eventCount: (hoveredNode.eventIds || []).length,
      eventTitles,
    };
  }, [hoveredNode, visibleEdges, eventById]);

  const handleNodeClick = (id) => {
    onEntitySelect?.(id === selectedEntity ? null : id);
  };

  const handleNodeEnter = (node, ev) => {
    setHoveredId(node.id);
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (rect) {
      setTooltipPos({
        x: ev.clientX - rect.left + 12,
        y: ev.clientY - rect.top - 8,
      });
    }
  };

  const handleNodeMove = (ev) => {
    const rect = wrapperRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltipPos({
      x: ev.clientX - rect.left + 12,
      y: ev.clientY - rect.top - 8,
    });
  };

  const handleNodeLeave = () => {
    setHoveredId(null);
    setTooltipPos(null);
  };

  const handleBackgroundClick = () => {
    if (selectedEntity) onEntitySelect?.(null);
  };

  const typeLegend = useMemo(() => {
    const counts = { person: 0, organization: 0, location: 0 };
    for (const n of positioned) counts[n.type] = (counts[n.type] || 0) + 1;
    return counts;
  }, [positioned]);

  return (
    <div
      ref={wrapperRef}
      className="entity-graph-wrapper"
      style={{ position: 'relative', width, height }}
    >
      <svg
        className="entity-graph-svg"
        width={width}
        height={height}
        onClick={handleBackgroundClick}
        role="img"
        aria-label="Entity relationship graph"
      >
        {/* Guide ring — subtle inner outline */}
        <circle
          cx={cx}
          cy={cy}
          r={radius}
          fill="none"
          stroke="rgba(50, 56, 70, 0.35)"
          strokeDasharray="2 6"
          strokeWidth={1}
        />

        {/* Edges */}
        <g>
          {visibleEdges.map((e) => {
            const a = nodeIndex.get(e.source);
            const b = nodeIndex.get(e.target);
            if (!a || !b) return null;
            const highlighted = selectedEntity
              ? connectedIds.has(e.source) && connectedIds.has(e.target)
              : false;
            const dimmed = selectedEntity && !highlighted;
            const weight = Math.max(1, Math.min(e.weight || 1, 5));
            const strokeWidth = highlighted ? weight : weight * 0.5;
            return (
              <path
                key={`${e.source}—${e.target}`}
                d={chordPath(a, b, cx, cy)}
                fill="none"
                stroke={highlighted ? EDGE_HIGH : dimmed ? EDGE_DIM : EDGE_BASE}
                strokeWidth={Math.max(0.6, strokeWidth)}
                pointerEvents="none"
              />
            );
          })}
        </g>

        {/* Nodes + labels */}
        <g>
          {positioned.map((node) => {
            const isSelected = node.id === selectedEntity;
            const isHovered = node.id === hoveredId;
            const isConnected = connectedIds.has(node.id);
            const dimmed = selectedEntity && !isConnected;
            const color = TYPE_COLORS[node.type] || '#999';
            const r = node.radius + (isSelected ? 2 : 0);

            // Label position just outside the ring.
            const labelDist = radius + LABEL_GAP;
            const lx = cx + labelDist * Math.cos(node.theta);
            const ly = cy + labelDist * Math.sin(node.theta);
            const angleDeg = (node.theta * 180) / Math.PI;
            const flip = angleDeg > 90 || angleDeg < -90;
            const textAnchor = flip ? 'end' : 'start';
            const rotate = flip ? angleDeg + 180 : angleDeg;
            const showLabel = isSelected || isHovered || (isConnected && selectedEntity) || node.radius >= 6;

            return (
              <g
                key={node.id}
                className="entity-graph-node"
                onClick={(ev) => { ev.stopPropagation(); handleNodeClick(node.id); }}
                onMouseEnter={(ev) => handleNodeEnter(node, ev)}
                onMouseMove={handleNodeMove}
                onMouseLeave={handleNodeLeave}
                style={{ cursor: 'pointer' }}
              >
                {isSelected && (
                  <circle cx={node.x} cy={node.y} r={r + 3} fill="none" stroke="#e8a33d" strokeWidth={1.5} />
                )}
                {isHovered && !isSelected && (
                  <circle cx={node.x} cy={node.y} r={r + 2} fill="none" stroke={INK_2} strokeWidth={1} />
                )}
                <circle
                  cx={node.x}
                  cy={node.y}
                  r={r}
                  fill={color}
                  fillOpacity={dimmed ? 0.22 : 1}
                />
                {showLabel && (
                  <text
                    x={lx}
                    y={ly}
                    fontFamily='"IBM Plex Mono", ui-monospace, Menlo, monospace'
                    fontSize={10}
                    fill={dimmed ? INK_3 : INK_0}
                    textAnchor={textAnchor}
                    dominantBaseline="central"
                    transform={`rotate(${rotate} ${lx} ${ly})`}
                    pointerEvents="none"
                  >
                    {node.name}
                  </text>
                )}
              </g>
            );
          })}
        </g>

        {/* Centre caption */}
        <g pointerEvents="none">
          <text
            x={cx}
            y={cy - 6}
            textAnchor="middle"
            fontFamily='"IBM Plex Mono", ui-monospace, Menlo, monospace'
            fontSize={10}
            letterSpacing="0.16em"
            fill={INK_2}
          >
            {positioned.length} / {nodes.length} NODES
          </text>
          <text
            x={cx}
            y={cy + 8}
            textAnchor="middle"
            fontFamily='"IBM Plex Mono", ui-monospace, Menlo, monospace'
            fontSize={10}
            letterSpacing="0.16em"
            fill={INK_3}
          >
            {visibleEdges.length} EDGES
          </text>
        </g>

        {/* Legend (bottom-left of svg) */}
        <g transform={`translate(12, ${height - 20})`}>
          {TYPE_ORDER.map((type, i) => (
            <g key={type} transform={`translate(${i * 110}, 0)`}>
              <circle cx={0} cy={0} r={4} fill={TYPE_COLORS[type]} />
              <text
                x={8}
                y={0}
                dominantBaseline="central"
                fontFamily='"IBM Plex Mono", ui-monospace, Menlo, monospace'
                fontSize={10}
                letterSpacing="0.12em"
                fill={INK_2}
              >
                {TYPE_LABELS[type].toUpperCase()} · {typeLegend[type] || 0}
              </text>
            </g>
          ))}
        </g>
      </svg>

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
