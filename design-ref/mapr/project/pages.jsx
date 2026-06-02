/* Page surfaces: Region, Entities, Trends, Admin */
const { useState: useS3, useEffect: useE3, useRef: useR3, useMemo: useM3, useCallback: useC3 } = React;
const { Sparkline: Spark, Ico: IC3, ago: ago3 } = window.MAPR_SHELL;
const { MiniMap } = window.MAPR_MAP;

// ============ /region/:iso ============
function RegionPage({ iso, setRoute, onEventClick }) {
  const region = window.MAPR_DATA.REGIONS.find(r => r.iso === iso) || window.MAPR_DATA.REGIONS[0];
  const articles = window.MAPR_DATA.articlesFor(region.iso);
  const events = window.MAPR_DATA.EVENTS;
  const sevClass = region.avg >= 6 ? "sev-red" : region.avg >= 4 ? "sev-amber" : "";
  const trend = useM3(() => {
    const out = [];
    for (let i=0;i<48;i++) out.push(region.avg + Math.sin(i*0.3 + region.iso.charCodeAt(0))*1.5 + (Math.random()-0.5));
    return out;
  }, [region.iso]);

  return (
    <div className="region-page">
      <div className="region-header">
        <div>
          <div className="region-crumb">
            <span onClick={() => setRoute("/")} style={{cursor:"pointer", textDecoration:"underline", textUnderlineOffset:3}}>/ MAP</span>
            &nbsp;›&nbsp;REGION&nbsp;›&nbsp;<b style={{color:"var(--ink-0)"}}>{region.iso}</b>
          </div>
          <div className="region-name">{region.name}</div>
          <div className="region-iso">ISO-3166-1 · {region.iso} · LAT {iso==="UKR"?"48.38":"—"} LON {iso==="UKR"?"31.17":"—"}</div>
        </div>
        <div className="region-stats">
          <div className="stat">
            <span className="label">AVG SEVERITY · 24H</span>
            <span className={`val ${sevClass}`}>{region.avg.toFixed(2)}</span>
            <span className="sub">σ 1.42 · n={region.count}</span>
          </div>
          <div className="stat">
            <span className="label">EVENTS · 24H</span>
            <span className="val">{region.count}</span>
            <span className="sub" style={{color: region.trend > 0 ? "var(--sev-red)" : "var(--sev-green)"}}>{region.trend > 0 ? "+" : ""}{region.trend}% vs 7d</span>
          </div>
          <div className="stat">
            <span className="label">SOURCES</span>
            <span className="val">{Math.floor(region.count * 0.8)}</span>
            <span className="sub">of 312 active</span>
          </div>
          <div className="stat">
            <span className="label">CORR. SCORE</span>
            <span className="val">{(0.72 + Math.random()*0.2).toFixed(2)}</span>
            <span className="sub">cross-source</span>
          </div>
          <div className="stat" style={{width:140}}>
            <span className="label">TREND · 48×7.5M</span>
            <div style={{marginTop:4}}>
              <Spark data={trend} color="var(--amber)" w={140} h={40}/>
            </div>
          </div>
        </div>
      </div>

      <div className="region-articles">
        <div style={{padding:"12px 16px", borderBottom:"1px solid var(--line)", display:"flex", alignItems:"center", gap:12}}>
          <div className="micro">ARTICLES · FILTERED BY REGION</div>
          <div style={{marginLeft:"auto", display:"flex", gap:4}}>
            {["ALL","WIRE","GOV","LOCAL"].map(t => (
              <button key={t} className="chip" data-active={t==="ALL"}>{t}</button>
            ))}
          </div>
        </div>
        {articles.map(a => (
          <div key={a.id} className="news-item" onClick={() => a.lon !== undefined && onEventClick(a)}>
            <div className="news-meta">
              <span className={`sev-pill sev-${a.tier}`}>{a.tier.toUpperCase()}·{a.sev.toFixed(1)}</span>
              {a.cat && <span className="tag">{a.cat.toUpperCase()}</span>}
              <span style={{marginLeft:"auto"}}>{a.lang.toUpperCase()}</span>
              <span>·</span>
              <span>{ago3(a.ts)} ago</span>
            </div>
            <div className="news-title">{a.title}</div>
            <div className="news-src"><span className="mono">{a.id}</span> · {a.src}</div>
          </div>
        ))}
      </div>

      <div className="region-minimap">
        <div style={{position:"absolute", top:12, left:12, zIndex:2, background:"var(--bg-1)", border:"1px solid var(--line)", padding:"6px 10px"}}>
          <div className="micro">MINI-MAP · {region.iso}</div>
        </div>
        <MiniMap iso={region.iso} events={events} />
        <div style={{position:"absolute", bottom:12, right:12, display:"flex", gap:6}}>
          <button className="btn" onClick={() => setRoute("/")}>‹ BACK TO MAP</button>
          <button className="btn primary">FULL REPORT</button>
        </div>
      </div>
    </div>
  );
}

// ============ /entities ============
function EntitiesPage({ setRoute }) {
  const nodes = window.MAPR_DATA.ENTITIES;
  const edges = window.MAPR_DATA.ENTITY_EDGES;
  const ref = useR3(null);
  const [size, setSize] = useS3({ w: 800, h: 600 });
  const [pan, setPan] = useS3([0,0]);
  const [zoom, setZoom] = useS3(1);
  const [selected, setSelected] = useS3("E15"); // Tehran
  const [dragNode, setDragNode] = useS3(null);
  const [positions, setPositions] = useS3(() => {
    const m = {};
    for (const n of nodes) m[n.id] = { x: n.x, y: n.y };
    return m;
  });

  useE3(() => {
    if (!ref.current) return;
    const ro = new ResizeObserver(es => { for (const e of es) setSize({ w: e.contentRect.width, h: e.contentRect.height }); });
    ro.observe(ref.current); return () => ro.disconnect();
  }, []);

  // Canvas pan (on background)
  useE3(() => {
    const el = ref.current; if (!el) return;
    let start = null;
    const down = (e) => {
      if (e.target !== el && !e.target.classList?.contains("entity-bg")) return;
      start = { x: e.clientX, y: e.clientY, pan: [...pan] };
    };
    const move = (e) => {
      if (!start) return;
      setPan([start.pan[0] + (e.clientX - start.x), start.pan[1] + (e.clientY - start.y)]);
    };
    const up = () => { start = null; };
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [pan]);

  // Node drag
  useE3(() => {
    const onMove = (e) => {
      if (!dragNode) return;
      const rect = ref.current.getBoundingClientRect();
      const x = (e.clientX - rect.left - pan[0]) / (size.w * zoom);
      const y = (e.clientY - rect.top - pan[1]) / (size.h * zoom);
      setPositions(p => ({ ...p, [dragNode]: { x, y } }));
    };
    const onUp = () => setDragNode(null);
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => { window.removeEventListener("mousemove", onMove); window.removeEventListener("mouseup", onUp); };
  }, [dragNode, pan, zoom, size]);

  // Wheel zoom
  useE3(() => {
    const el = ref.current; if (!el) return;
    const wheel = (e) => { e.preventDefault(); setZoom(z => Math.max(0.4, Math.min(3, z * (1 - e.deltaY*0.002)))); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const pos = (id) => {
    const p = positions[id];
    return [pan[0] + p.x * size.w * zoom, pan[1] + p.y * size.h * zoom];
  };

  const selNode = nodes.find(n => n.id === selected);
  const connectedIds = new Set();
  for (const [a,b] of edges) {
    if (a === selected) connectedIds.add(b);
    if (b === selected) connectedIds.add(a);
  }

  const typeColor = (t) => t === "org" ? "var(--amber)" : t === "loc" ? "var(--cyan)" : "var(--sev-green)";

  return (
    <div className="entities-page">
      <div className="entity-canvas" ref={ref}>
        {/* Background for pan-hit testing */}
        <svg className="map-svg entity-bg" width="100%" height="100%" style={{cursor: "grab"}}>
          <defs>
            <pattern id="dots" width="24" height="24" patternUnits="userSpaceOnUse">
              <circle cx="1" cy="1" r="0.7" fill="var(--line-2)"/>
            </pattern>
          </defs>
          <rect className="entity-bg" width="100%" height="100%" fill="url(#dots)" />
          {/* Edges */}
          <g>
            {edges.map(([a,b],i) => {
              const [x1,y1] = pos(a), [x2,y2] = pos(b);
              const active = a === selected || b === selected;
              return <line key={i} className="entity-edge" data-active={active}
                x1={x1} y1={y1} x2={x2} y2={y2}
                stroke={active ? "var(--amber)" : "var(--line-2)"}
                strokeWidth={active ? 1.2 : 0.6}
                opacity={selected && !active ? 0.35 : 1}/>;
            })}
          </g>
          {/* Nodes */}
          <g>
            {nodes.map(n => {
              const [x,y] = pos(n.id);
              const r = 6 + n.size * 0.6;
              const isSel = n.id === selected;
              const isConn = connectedIds.has(n.id);
              const color = typeColor(n.type);
              return (
                <g key={n.id} className="entity-node"
                   transform={`translate(${x},${y})`}
                   onMouseDown={(e) => { e.stopPropagation(); setDragNode(n.id); }}
                   onClick={(e) => { e.stopPropagation(); setSelected(n.id); }}
                   opacity={selected && !isSel && !isConn ? 0.3 : 1}>
                  {isSel && <circle r={r+5} fill="none" stroke="var(--amber)" strokeWidth="1" opacity="0.6"/>}
                  <circle r={r} fill={isSel ? color : "var(--bg-1)"} stroke={color} strokeWidth={isSel ? 0 : 1.2}/>
                  <text y={r + 14} fontFamily="var(--ff-mono)" fill={isSel ? "var(--ink-0)" : "var(--ink-1)"}>{n.label}</text>
                  {n.type === "person" && <text y={3} fontSize="9" fill={isSel ? "var(--bg-0)" : color}>P</text>}
                  {n.type === "loc" && <text y={3} fontSize="9" fill={isSel ? "var(--bg-0)" : color}>◆</text>}
                  {n.type === "org" && <text y={3} fontSize="9" fill={isSel ? "var(--bg-0)" : color}>■</text>}
                </g>
              );
            })}
          </g>
        </svg>
        <div className="map-chrome">
          <div className="map-corner tl">
            <div>ENTITY GRAPH · 2B HORIZON</div>
            <div style={{color:"var(--ink-0)", marginTop:4}}>{nodes.length} NODES · {edges.length} EDGES</div>
          </div>
          <div className="map-corner tr">
            <div style={{display:"flex", gap:12}}>
              <span><span style={{color:"var(--amber)"}}>■</span> ORG · {nodes.filter(n=>n.type==="org").length}</span>
              <span><span style={{color:"var(--cyan)"}}>◆</span> LOC · {nodes.filter(n=>n.type==="loc").length}</span>
              <span><span style={{color:"var(--sev-green)"}}>P</span> PERSON · {nodes.filter(n=>n.type==="person").length}</span>
            </div>
          </div>
          <div className="map-corner bl">
            <div>ZOOM · {zoom.toFixed(2)}× · DRAG NODES</div>
          </div>
        </div>
      </div>

      <aside className="entity-panel">
        <div className="panel-header" style={{height:32}}>
          <span className="dot" style={{background: typeColor(selNode.type)}}/>
          ENTITY · <span className="mono" style={{color:"var(--ink-0)", marginLeft:4}}>{selNode.id}</span>
        </div>
        <div style={{padding:"20px 20px 14px"}}>
          <div className="micro" style={{marginBottom:6}}>{selNode.type.toUpperCase()}</div>
          <h2 style={{fontFamily:"var(--ff-serif)", fontWeight:400, margin:"0 0 6px", fontSize:24}}>{selNode.label}</h2>
          <div className="mono" style={{color:"var(--ink-2)", fontSize:10, letterSpacing:"0.12em", textTransform:"uppercase"}}>
            DEG {connectedIds.size} · CENTRALITY {(0.3 + Math.random()*0.5).toFixed(2)}
          </div>
        </div>
        <div style={{borderTop:"1px solid var(--line)", padding:"12px 20px"}}>
          <div className="micro" style={{marginBottom:8}}>MENTIONED IN · 7D</div>
          <div style={{display:"grid", gridTemplateColumns:"1fr 1fr 1fr", gap:8, fontFamily:"var(--ff-mono)", fontSize:11}}>
            <div><div style={{color:"var(--ink-0)", fontSize:18}}>{Math.floor(Math.random()*400)+80}</div><div style={{color:"var(--ink-2)", fontSize:9, letterSpacing:"0.1em"}}>ARTICLES</div></div>
            <div><div style={{color:"var(--ink-0)", fontSize:18}}>{Math.floor(Math.random()*40)+10}</div><div style={{color:"var(--ink-2)", fontSize:9, letterSpacing:"0.1em"}}>SOURCES</div></div>
            <div><div style={{color:"var(--sev-amber)", fontSize:18}}>+{Math.floor(Math.random()*60)+5}%</div><div style={{color:"var(--ink-2)", fontSize:9, letterSpacing:"0.1em"}}>VS 30D</div></div>
          </div>
        </div>
        <div style={{borderTop:"1px solid var(--line)", padding:"12px 20px"}}>
          <div className="micro" style={{marginBottom:8}}>CONNECTED · {connectedIds.size}</div>
          {[...connectedIds].map(id => {
            const n = nodes.find(x => x.id === id);
            return (
              <div key={id} onClick={() => setSelected(id)}
                style={{padding:"5px 0", borderBottom:"1px solid var(--line)", display:"flex", gap:8, fontSize:12, cursor:"pointer"}}>
                <span style={{width:14, color:typeColor(n.type), fontFamily:"var(--ff-mono)"}}>
                  {n.type === "org" ? "■" : n.type === "loc" ? "◆" : "P"}
                </span>
                <span style={{flex:1, color:"var(--ink-0)"}}>{n.label}</span>
                <span className="mono" style={{color:"var(--ink-2)", fontSize:10}}>{n.id}</span>
              </div>
            );
          })}
        </div>
        <div style={{borderTop:"1px solid var(--line)", padding:"12px 20px"}}>
          <div className="micro" style={{marginBottom:8}}>ALIASES</div>
          <div className="chip-row">
            {["QF","IRGC-QF","القوة القدس"].map(a => <span key={a} className="chip" style={{cursor:"default"}}>{a}</span>)}
          </div>
        </div>
        <div style={{padding:"14px 20px", display:"flex", gap:8}}>
          <button className="btn primary" onClick={() => setRoute("/")}>SHOW ON MAP</button>
          <button className="btn">PIN</button>
          <button className="btn">EXPORT</button>
        </div>
      </aside>
    </div>
  );
}

// ============ /trends ============
function TrendLineChart({ series, w=640, h=240, area=false, showGrid=true }) {
  const len = series[0].data.length;
  const max = Math.max(...series.flatMap(s => s.data));
  const min = 0;
  const pad = { l: 44, r: 12, t: 16, b: 24 };
  const iw = w - pad.l - pad.r;
  const ih = h - pad.t - pad.b;
  const xAt = (i) => pad.l + (i / (len - 1)) * iw;
  const yAt = (v) => pad.t + ih - ((v - min) / (max - min)) * ih;
  const gridY = 5;
  return (
    <svg width={w} height={h} style={{display:"block", width:"100%"}} viewBox={`0 0 ${w} ${h}`}>
      {showGrid && Array.from({length: gridY+1}).map((_,i) => (
        <g key={i}>
          <line x1={pad.l} x2={w-pad.r} y1={pad.t + i * ih/gridY} y2={pad.t + i * ih/gridY}
            stroke="var(--line)" strokeWidth="0.5"/>
          <text x={pad.l-6} y={pad.t + i * ih/gridY + 3} fontSize="9" fill="var(--ink-2)" textAnchor="end"
            fontFamily="var(--ff-mono)">{Math.round(max - i * (max-min)/gridY)}</text>
        </g>
      ))}
      {Array.from({length: 7}).map((_,i) => {
        const x = pad.l + (i / 6) * iw;
        return (
          <g key={i}>
            <line x1={x} x2={x} y1={pad.t} y2={h-pad.b} stroke="var(--line)" strokeWidth="0.5" opacity="0.5"/>
            <text x={x} y={h-8} fontSize="9" fill="var(--ink-2)" textAnchor="middle" fontFamily="var(--ff-mono)">
              {`-${30-i*5}d`}
            </text>
          </g>
        );
      })}
      {series.map((s, si) => {
        const pts = s.data.map((v,i) => `${xAt(i)},${yAt(v)}`).join(" ");
        const color = s.color || ["var(--amber)", "var(--cyan)", "var(--sev-red)", "var(--sev-green)"][si % 4];
        if (area) {
          const areaD = `M${xAt(0)},${yAt(0)} L${s.data.map((v,i) => `${xAt(i)},${yAt(v)}`).join(" L")} L${xAt(len-1)},${yAt(0)} Z`;
          return (
            <g key={si}>
              <path d={areaD} fill={color} opacity="0.15"/>
              <polyline points={pts} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke"/>
            </g>
          );
        }
        return <polyline key={si} points={pts} fill="none" stroke={color} strokeWidth="1.3" vectorEffect="non-scaling-stroke"/>;
      })}
    </svg>
  );
}

function HorizonChart({ series, w=640, h=180 }) {
  const labels = series.map(s => s.label);
  const row = (h - 20) / series.length;
  const pad = 80;
  const iw = w - pad;
  const max = Math.max(...series.flatMap(s => s.data));
  return (
    <svg width={w} height={h} style={{display:"block", width:"100%"}} viewBox={`0 0 ${w} ${h}`}>
      {series.map((s, si) => {
        const y0 = 10 + si * row + row;
        return (
          <g key={si}>
            <text x={pad - 10} y={y0 - row/2 + 3} fontSize="10" fill="var(--ink-0)" textAnchor="end"
              fontFamily="var(--ff-mono)">{s.label}</text>
            <line x1={pad} x2={w} y1={y0} y2={y0} stroke="var(--line)" strokeWidth="0.4"/>
            {s.data.map((v,i) => {
              const x = pad + (i / (s.data.length-1)) * iw;
              const bw = iw / s.data.length;
              const hh = (v / max) * (row - 4);
              return <rect key={i} x={x} y={y0 - hh} width={bw-1} height={hh}
                fill={["var(--amber)","var(--sev-red)","var(--cyan)","var(--sev-green)","var(--sev-amber)","var(--cyan)"][si % 6]}
                opacity="0.9"/>;
            })}
          </g>
        );
      })}
    </svg>
  );
}

function TrendsPage() {
  const t = window.MAPR_DATA.TRENDS;
  return (
    <div className="trends-page">
      <div className="trend-card span-2">
        <div className="head">
          <h3>Event volume · by region · 30 days</h3>
          <div className="mono">Δ window: <b style={{color:"var(--amber)"}}>30D / 2H BUCKETS</b></div>
        </div>
        <div className="body" style={{position:"relative"}}>
          <TrendLineChart series={t.regional} h={260} area={false}/>
          <div style={{position:"absolute", top:20, right:24, display:"flex", gap:14, fontFamily:"var(--ff-mono)", fontSize:10, letterSpacing:"0.1em"}}>
            {t.regional.map((s,i) => (
              <span key={s.label}><span style={{display:"inline-block", width:10, height:2, background:s.color, verticalAlign:"middle", marginRight:4}}/>{s.label.toUpperCase()}</span>
            ))}
          </div>
        </div>
      </div>

      <div className="trend-card span-2">
        <div className="head">
          <h3>Severity distribution · by category · 14 days</h3>
          <div className="mono">HORIZON</div>
        </div>
        <div className="body">
          <HorizonChart series={t.byCat} h={200}/>
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>Language mix · news feed</h3>
          <div className="mono">7D</div>
        </div>
        <div className="body">
          {[
            ["EN", 42], ["ES", 12], ["AR", 9], ["FR", 8], ["ZH", 7], ["RU", 6], ["PT", 5], ["JA", 4], ["DE", 3], ["OTHER", 4]
          ].map(([l,v]) => (
            <div key={l} style={{display:"grid", gridTemplateColumns:"40px 1fr 32px", alignItems:"center", gap:8, margin:"6px 0"}}>
              <span className="mono" style={{color:"var(--ink-1)", fontSize:11}}>{l}</span>
              <div style={{height:10, background:"var(--bg-2)"}}>
                <div style={{height:"100%", width:`${v*2}%`, background:"var(--amber)"}}/>
              </div>
              <span className="mono" style={{color:"var(--ink-2)", fontSize:10, textAlign:"right"}}>{v}%</span>
            </div>
          ))}
        </div>
      </div>

      <div className="trend-card">
        <div className="head">
          <h3>Top trending entities</h3>
          <div className="mono">24H</div>
        </div>
        <div className="body">
          {[
            ["ORG","Black Basta","+214%","var(--sev-red)"],
            ["LOC","Buenos Aires","+87%","var(--sev-red)"],
            ["ORG","UNC4841","+72%","var(--sev-amber)"],
            ["PER","Gen. Budanov","+41%","var(--sev-amber)"],
            ["LOC","Bab-el-Mandeb","+33%","var(--sev-amber)"],
            ["ORG","PBoC","+28%","var(--sev-amber)"],
            ["LOC","Amhara","+22%","var(--amber)"],
          ].map((row,i) => (
            <div key={i} style={{display:"grid", gridTemplateColumns:"36px 1fr 60px", alignItems:"center", padding:"6px 0", borderBottom:"1px solid var(--line)", fontFamily:"var(--ff-mono)", fontSize:11}}>
              <span style={{color:"var(--ink-2)", fontSize:10}}>{row[0]}</span>
              <span style={{color:"var(--ink-0)", fontFamily:"var(--ff-sans)", fontSize:12}}>{row[1]}</span>
              <span style={{color: row[3], textAlign:"right"}}>{row[2]}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ============ /admin ============
function AdminPage() {
  const sources = window.MAPR_DATA.SOURCES;
  const [filter, setFilter] = useS3("all");
  const [sort, setSort] = useS3("status");
  const filtered = sources
    .filter(s => filter === "all" ? true : s.status === filter)
    .sort((a,b) => {
      if (sort === "status") return (a.status === "err" ? 0 : a.status === "warn" ? 1 : 2) - (b.status === "err" ? 0 : b.status === "warn" ? 1 : 2);
      if (sort === "latency") return b.latency - a.latency;
      if (sort === "uptime") return a.uptime - b.uptime;
      if (sort === "rate") return b.rate - a.rate;
      return a.name.localeCompare(b.name);
    });

  const n = sources.length;
  const online = sources.filter(s => s.status === "ok").length;
  const warn = sources.filter(s => s.status === "warn").length;
  const err = sources.filter(s => s.status === "err").length;
  const avgLat = Math.round(sources.filter(s=>s.status!=="err").reduce((a,s)=>a+s.latency,0) / Math.max(1, sources.filter(s=>s.status!=="err").length));
  const totalIngest = sources.reduce((a,s)=>a+s.rate,0);

  return (
    <div className="admin-page">
      <div className="admin-head">
        <h2>Source health</h2>
        <div className="mono" style={{color:"var(--ink-2)", fontSize:11, letterSpacing:"0.1em"}}>INGESTION · NEWS-API v4 · {new Date().toISOString().slice(0,19)}Z</div>
        <div style={{marginLeft:"auto", display:"flex", gap:6}}>
          <button className="btn">EXPORT CSV</button>
          <button className="btn primary">ADD SOURCE</button>
        </div>
      </div>

      <div className="kpis">
        <div className="kpi"><div className="k">SOURCES · TOTAL</div><div className="v">{n}</div><div className="d">+4 vs 7d</div></div>
        <div className="kpi"><div className="k">ONLINE</div><div className="v ok" style={{color:"var(--sev-green)"}}>{online}</div><div className="d">{((online/n)*100).toFixed(1)}% avail.</div></div>
        <div className="kpi"><div className="k">DEGRADED</div><div className="v" style={{color:"var(--sev-amber)"}}>{warn}</div><div className="d neg">retry scheduled</div></div>
        <div className="kpi"><div className="k">OFFLINE</div><div className="v" style={{color:"var(--sev-red)"}}>{err}</div><div className="d neg">paging on-call</div></div>
        <div className="kpi"><div className="k">AVG LATENCY</div><div className="v">{avgLat}<span style={{fontSize:12, color:"var(--ink-2)"}}>ms</span></div><div className="d">p50 poll-to-index</div></div>
        <div className="kpi"><div className="k">INGEST · 1H</div><div className="v">{totalIngest.toLocaleString()}</div><div className="d">articles / hr</div></div>
      </div>

      <div style={{display:"flex", gap:16, alignItems:"center", marginBottom:14}}>
        <div className="micro">FILTER</div>
        <div className="chip-row">
          {[["all","ALL"],["ok","OK"],["warn","DEGRADED"],["err","OFFLINE"]].map(([k,l]) => (
            <button key={k} className="chip" data-active={filter===k} onClick={()=>setFilter(k)}>{l}</button>
          ))}
        </div>
        <div className="micro" style={{marginLeft:24}}>SORT</div>
        <div className="chip-row">
          {["status","name","latency","uptime","rate"].map(k => (
            <button key={k} className="chip" data-active={sort===k} onClick={()=>setSort(k)}>{k.toUpperCase()}</button>
          ))}
        </div>
      </div>

      <div style={{background:"var(--bg-1)", border:"1px solid var(--line-2)"}}>
        <table className="src-table">
          <thead>
            <tr>
              <th style={{width:40}}>●</th>
              <th style={{width:100}}>ID</th>
              <th>SOURCE</th>
              <th style={{width:80}}>LANG</th>
              <th style={{width:80}}>KIND</th>
              <th style={{width:80}}>LATENCY</th>
              <th style={{width:90}}>RATE/H</th>
              <th style={{width:80}}>UPTIME</th>
              <th style={{width:140}}>24H</th>
              <th style={{width:32}}></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map(s => (
              <tr key={s.id}>
                <td>
                  <span style={{color: s.status==="ok" ? "var(--sev-green)" : s.status==="warn" ? "var(--sev-amber)" : "var(--sev-red)"}}>●</span>
                </td>
                <td className="u">{s.id}</td>
                <td className="n">{s.name} <span style={{color:"var(--ink-3)"}}>· {s.url}</span></td>
                <td>{s.lang.toUpperCase()}</td>
                <td className="u">{s.kind.toUpperCase()}</td>
                <td className={s.status==="err"?"err":s.status==="warn"?"warn":"ok"}>{s.latency === 9999 ? "—" : s.latency+"ms"}</td>
                <td>{s.status==="err" ? "0" : s.rate}</td>
                <td className={s.uptime >= 99 ? "ok" : s.uptime >= 97 ? "warn" : "err"}>{s.uptime.toFixed(2)}%</td>
                <td>
                  <div className="uptime-bar">
                    {s.uptime24.map((x,i) => <span key={i} className={x}/>)}
                  </div>
                </td>
                <td style={{textAlign:"right"}}><button style={{color:"var(--ink-2)"}}>⋯</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div style={{marginTop:24, display:"grid", gridTemplateColumns:"1fr 1fr", gap:16}}>
        <div className="trend-card">
          <div className="head"><h3>Coverage gaps · by region</h3><div className="mono">72H</div></div>
          <div className="body">
            {[
              ["Central Africa", 62, "var(--sev-red)"],
              ["Central Asia", 41, "var(--sev-amber)"],
              ["Pacific Islands", 38, "var(--sev-amber)"],
              ["Caucasus", 22, "var(--sev-amber)"],
              ["Andean corridor", 14, "var(--amber)"],
            ].map(([n,v,c]) => (
              <div key={n} style={{display:"grid", gridTemplateColumns:"140px 1fr 40px", alignItems:"center", gap:8, margin:"8px 0", fontFamily:"var(--ff-mono)", fontSize:11}}>
                <span style={{color:"var(--ink-0)", fontFamily:"var(--ff-sans)", fontSize:12}}>{n}</span>
                <div style={{height:8, background:"var(--bg-2)"}}>
                  <div style={{height:"100%", width:`${v}%`, background:c}}/>
                </div>
                <span style={{color:c, textAlign:"right"}}>-{v}%</span>
              </div>
            ))}
          </div>
        </div>
        <div className="trend-card">
          <div className="head"><h3>Ingestion pipeline</h3><div className="mono">LIVE</div></div>
          <div className="body">
            {[
              ["POLL · rss/atom", "8,412/h", "ok", "99.98%"],
              ["POLL · api/sitemap", "2,201/h", "ok", "99.91%"],
              ["FETCH · full article body", "10,613/h", "warn", "98.12%"],
              ["DEDUPE · near-duplicate merge", "10,041/h", "ok", "99.87%"],
              ["NLP · NER + geo-resolve", "9,977/h", "ok", "99.74%"],
              ["SCORE · severity classifier", "9,965/h", "ok", "99.64%"],
              ["INDEX · elastic + graph", "9,963/h", "ok", "99.98%"],
            ].map((row,i) => (
              <div key={i} style={{display:"grid", gridTemplateColumns:"20px 1fr 90px 70px", alignItems:"center", padding:"6px 0", borderBottom:"1px solid var(--line)", fontFamily:"var(--ff-mono)", fontSize:11}}>
                <span style={{color: row[2]==="ok" ? "var(--sev-green)" : "var(--sev-amber)"}}>●</span>
                <span style={{color:"var(--ink-0)", fontFamily:"var(--ff-sans)", fontSize:12}}>{row[0]}</span>
                <span style={{color:"var(--ink-1)", textAlign:"right"}}>{row[1]}</span>
                <span style={{color: row[2]==="ok" ? "var(--sev-green)" : "var(--sev-amber)", textAlign:"right"}}>{row[3]}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

window.MAPR_PAGES = { RegionPage, EntitiesPage, TrendsPage, AdminPage };
