import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import "./entities.css";

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

const VB_W = 900;
const VB_H = 600;
const PAD = 60;

function sevColor(severity) {
  if (severity >= 7) return "var(--sev-red)";
  if (severity >= 5) return "var(--sev-amber)";
  return "var(--sev-green)";
}

// Deterministic, lib-free force-directed layout. Seeds via golden angle,
// runs a fixed number of iterations, then fits the result into the viewBox.
function layout(nodes, edges) {
  const n = nodes.length;
  if (n === 0) return { pos: {}, radii: {} };

  const cx = VB_W / 2;
  const cy = VB_H / 2;
  const GA = Math.PI * (3 - Math.sqrt(5)); // golden angle
  const px = new Float64Array(n);
  const py = new Float64Array(n);
  const idIndex = new Map();
  nodes.forEach((node, i) => {
    idIndex.set(node.id, i);
    const r = 200 * Math.sqrt((i + 0.5) / n);
    const a = i * GA;
    px[i] = cx + r * Math.cos(a);
    py[i] = cy + r * Math.sin(a);
  });

  const links = edges
    .map((e) => ({ s: idIndex.get(e.source), t: idIndex.get(e.target), w: e.weight || 1 }))
    .filter((e) => e.s !== undefined && e.t !== undefined && e.s !== e.t);

  const K_REP = 9000; // repulsion strength
  const K_SPR = 0.02; // spring constant
  const REST = 90; // spring rest length
  const K_CTR = 0.012; // centering pull
  const ITER = 150;

  for (let it = 0; it < ITER; it++) {
    const dx = new Float64Array(n);
    const dy = new Float64Array(n);
    // pairwise repulsion
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let vx = px[i] - px[j];
        let vy = py[i] - py[j];
        let d2 = vx * vx + vy * vy;
        if (d2 < 1) d2 = 1;
        const d = Math.sqrt(d2);
        const f = K_REP / d2;
        const ux = (vx / d) * f;
        const uy = (vy / d) * f;
        dx[i] += ux; dy[i] += uy;
        dx[j] -= ux; dy[j] -= uy;
      }
    }
    // spring attraction along edges
    for (const e of links) {
      let vx = px[e.t] - px[e.s];
      let vy = py[e.t] - py[e.s];
      let d = Math.sqrt(vx * vx + vy * vy) || 1;
      const f = K_SPR * (d - REST) * Math.min(3, e.w);
      const ux = (vx / d) * f;
      const uy = (vy / d) * f;
      dx[e.s] += ux; dy[e.s] += uy;
      dx[e.t] -= ux; dy[e.t] -= uy;
    }
    // centering + integrate with damping
    const damp = 0.85;
    for (let i = 0; i < n; i++) {
      dx[i] += (cx - px[i]) * K_CTR;
      dy[i] += (cy - py[i]) * K_CTR;
      // clamp per-step displacement for stability
      const mx = Math.max(-30, Math.min(30, dx[i] * damp));
      const my = Math.max(-30, Math.min(30, dy[i] * damp));
      px[i] += mx;
      py[i] += my;
    }
  }

  // radii ∝ count
  const maxCount = Math.max(1, ...nodes.map((nd) => nd.count || 0));
  const radii = {};
  nodes.forEach((nd) => {
    radii[nd.id] = 5 + 20 * Math.sqrt((nd.count || 0) / maxCount);
  });

  // fit to viewBox
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  nodes.forEach((nd, i) => {
    const r = radii[nd.id];
    minX = Math.min(minX, px[i] - r); maxX = Math.max(maxX, px[i] + r);
    minY = Math.min(minY, py[i] - r); maxY = Math.max(maxY, py[i] + r);
  });
  const spanX = maxX - minX || 1;
  const spanY = maxY - minY || 1;
  const scale = Math.min((VB_W - 2 * PAD) / spanX, (VB_H - 2 * PAD) / spanY);
  const offX = (VB_W - spanX * scale) / 2;
  const offY = (VB_H - spanY * scale) / 2;

  const pos = {};
  nodes.forEach((nd, i) => {
    pos[nd.id] = {
      x: (px[i] - minX) * scale + offX,
      y: (py[i] - minY) * scale + offY,
    };
  });
  return { pos, radii, links };
}

function Graph({ nodes, edges, selected, onSelect }) {
  const [hovered, setHovered] = useState(null);
  const { pos, radii, links } = useMemo(() => layout(nodes, edges), [nodes, edges]);

  // label only the larger nodes to avoid clutter
  const labelThreshold = useMemo(() => {
    const sorted = [...nodes].map((n) => n.count || 0).sort((a, b) => b - a);
    return sorted[Math.min(sorted.length - 1, 11)] ?? 0; // top ~12
  }, [nodes]);

  const neighbors = useMemo(() => {
    if (!selected) return null;
    const set = new Set([selected]);
    (links ?? []).forEach((e) => {
      const sId = nodes[e.s].id;
      const tId = nodes[e.t].id;
      if (sId === selected) set.add(tId);
      if (tId === selected) set.add(sId);
    });
    return set;
  }, [selected, links, nodes]);

  const maxW = Math.max(1, ...edges.map((e) => e.weight || 1));

  return (
    <div className="ent-graph">
      <svg viewBox={`0 0 ${VB_W} ${VB_H}`} role="img" aria-label="Entity co-occurrence graph">
        <g className="edges">
          {(links ?? []).map((e, i) => {
            const a = pos[nodes[e.s].id];
            const b = pos[nodes[e.t].id];
            if (!a || !b) return null;
            const active = !selected || (neighbors && neighbors.has(nodes[e.s].id) && neighbors.has(nodes[e.t].id));
            return (
              <line
                key={i}
                className="edge"
                x1={a.x} y1={a.y} x2={b.x} y2={b.y}
                strokeWidth={Math.max(0.5, Math.min(4, 0.5 + (e.w / maxW) * 3.5))}
                strokeOpacity={active ? Math.max(0.18, Math.min(0.7, 0.18 + (e.w / maxW) * 0.5)) : 0.05}
              />
            );
          })}
        </g>
        <g className="nodes">
          {nodes.map((nd) => {
            const p = pos[nd.id];
            if (!p) return null;
            const r = radii[nd.id];
            const dim = selected && neighbors && !neighbors.has(nd.id);
            const isSel = selected === nd.id;
            const isHover = hovered === nd.id;
            return (
              <g
                key={nd.id}
                className="node"
                onMouseEnter={() => setHovered(nd.id)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => onSelect?.(selected === nd.id ? null : nd.id)}
                opacity={dim ? 0.2 : 1}
              >
                <circle
                  cx={p.x} cy={p.y} r={r}
                  fill={sevColor(nd.severity)}
                  fillOpacity={isSel ? 0.95 : 0.75}
                  stroke={isSel || isHover ? "var(--amber)" : "var(--bg-0)"}
                  strokeWidth={isSel || isHover ? 2 : 1}
                />
                {(nd.count >= labelThreshold || isSel || isHover) && (
                  <text className="node-label" x={p.x + r + 4} y={p.y + 3}>
                    {nd.id}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="ent-legend">
        <span className="lg"><span className="dot" style={{ background: "var(--sev-red)" }} /> Sev ≥ 7</span>
        <span className="lg"><span className="dot" style={{ background: "var(--sev-amber)" }} /> Sev ≥ 5</span>
        <span className="lg"><span className="dot" style={{ background: "var(--sev-green)" }} /> Sev &lt; 5</span>
      </div>
    </div>
  );
}
export default function EntityExplorerPage() {
  const [windowHours, setWindowHours] = useState(168);
  const [selectedEntity, setSelectedEntity] = useState(null);
  const [briefStatus, setBriefStatus] = useState(null);
  const data = useQuery(anyApi.entities.graph, { windowHours });
  const dossier = useQuery(anyApi.entities.dossier, selectedEntity ? { entity: selectedEntity, windowHours } : "skip");
  const generateBrief = useMutation(anyApi.briefs.generate);

  const isLoading = data === undefined;
  const nodes = data?.nodes ?? [];
  const edges = data?.edges ?? [];
  const hasGraph = nodes.length > 0;

  return (
    <div className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="micro">
          <Link to="/">← Map</Link>
        </div>
        <div className="ent-head">
          <h1 className="serif ent-title">Entity explorer</h1>
          <div className="win-seg">
            {WINDOWS.map((w) => (
              <button
                key={w.h}
                type="button"
                aria-pressed={windowHours === w.h}
                onClick={() => setWindowHours(w.h)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        <div className="ent-stats">
          <span><b className="tnum">{nodes.length}</b> nodes</span>
          <span><b className="tnum">{edges.length}</b> edges</span>
          <span><b className="tnum">{data?.total ?? 0}</b> co-occurrences</span>
        </div>

        {isLoading ? (
          <div className="card">Loading…</div>
        ) : !hasGraph ? (
          <div className="card">
            <p className="event-summary" style={{ color: "var(--ink-2)" }}>
              No entity co-occurrences yet — entities accrue as live events ingest.
            </p>
          </div>
        ) : (
          <div className="ent-layout">
            <div className="card">
              <Graph nodes={nodes} edges={edges} selected={selectedEntity} onSelect={setSelectedEntity} />
            </div>
            <div className="card ent-detail">
              {!selectedEntity ? (
                <p className="event-summary" style={{ color: "var(--ink-2)" }}>
                  Select a node to inspect its dossier, related regions, and generate a brief.
                </p>
              ) : dossier === undefined ? (
                <p className="event-summary" style={{ color: "var(--ink-2)" }}>Loading dossier…</p>
              ) : (
                <>
                  <h2 className="serif" style={{ margin: 0 }}>{dossier.entity}</h2>
                  <div className="ent-stats">
                    <span><b className="tnum">{dossier.eventCount}</b> events</span>
                    <span><b className="tnum">{dossier.maxSeverity.toFixed(1)}</b> max sev</span>
                  </div>
                  <div className="workbench-actions">
                    <button
                      className="btn primary"
                      onClick={async () => {
                        setBriefStatus("Briefing…");
                        try {
                          await generateBrief({ scopeType: "entity", scopeValue: dossier.entity, windowHours });
                          setBriefStatus("Brief saved");
                        } catch (err) {
                          setBriefStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required" : "Could not generate brief");
                        }
                      }}
                    >
                      Brief
                    </button>
                  </div>
                  {briefStatus && <div className="inline-status">{briefStatus}</div>}
                  <div className="workbench-box">
                    <div className="micro">Regions</div>
                    <p>{dossier.regions.map((r) => `${r.iso}: ${r.count}`).join(" · ") || "No regional pattern."}</p>
                  </div>
                  <div className="workbench-box">
                    <div className="micro">Related entities</div>
                    <div className="chip-row">
                      {dossier.related.map((r) => <span key={r.name} className="mini-chip">{r.name} · {r.count}</span>)}
                    </div>
                  </div>
                  <div className="ws-list">
                    {dossier.events.map((e) => (
                      <div key={e.id} className="ws-row">
                        <div className="grow">
                          <div className="name">{e.title}</div>
                          <div className="sub"><span>{e.isoA2}</span><span>{e.category}</span><span>{new Date(e.publishedAt).toLocaleString()}</span></div>
                        </div>
                        <span className={`sev-pill sev-${e.tier}`}>{e.tier.toUpperCase()} · {e.severity.toFixed(1)}</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
