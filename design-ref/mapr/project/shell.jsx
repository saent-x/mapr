/* Shared shell UI: header, sidebar, news panel, side panels, timeline, filter drawer, article sheet */
const { useState: useState2, useEffect: useEffect2, useRef: useRef2, useMemo: useMemo2 } = React;

// ---------- Brand mark ----------
function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden>
      <svg width="20" height="20" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="8.5" fill="none" stroke="var(--amber)" strokeWidth="1" />
        <path d="M10 1.5 L10 18.5 M1.5 10 L18.5 10" stroke="var(--amber)" strokeWidth="0.6" opacity="0.5" />
        <path d="M5 10 Q10 5 15 10 Q10 15 5 10 Z" fill="var(--amber)" />
        <circle cx="10" cy="10" r="1.5" fill="var(--bg-0)" />
      </svg>
    </div>
  );
}

// ---------- Iconography (line, 16px) ----------
const Ico = {
  map: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 6l6-3 6 3 6-3v15l-6 3-6-3-6 3V6z"/><path d="M9 3v15M15 6v15"/></svg>,
  region: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="9" ry="4"/><path d="M3 12h18M12 3v18"/></svg>,
  entities: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="6" cy="6" r="2"/><circle cx="18" cy="6" r="2"/><circle cx="12" cy="18" r="2"/><circle cx="12" cy="11" r="2"/><path d="M7.5 7l3 3M16.5 7l-3 3M12 13v3"/></svg>,
  trend: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><path d="M3 17l5-5 4 4 9-9"/><path d="M14 7h7v7"/></svg>,
  admin: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="4" width="18" height="5"/><rect x="3" y="11" width="18" height="5"/><circle cx="7" cy="6.5" r="1"/><circle cx="7" cy="13.5" r="1"/></svg>,
  search: <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.35-4.35"/></svg>,
  filter: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="M4 6h16M7 12h10M10 18h4"/></svg>,
  close: <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M6 6l12 12M6 18L18 6"/></svg>,
  globe: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><circle cx="12" cy="12" r="9"/><ellipse cx="12" cy="12" rx="4" ry="9"/><path d="M3 12h18"/></svg>,
  flat: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.3"><rect x="3" y="6" width="18" height="12"/><path d="M3 10h18M3 14h18M9 6v12M15 6v12"/></svg>,
  play: <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><path d="M3 2v12l11-6z"/></svg>,
  pause: <svg width="10" height="10" viewBox="0 0 16 16" fill="currentColor"><rect x="3" y="2" width="4" height="12"/><rect x="9" y="2" width="4" height="12"/></svg>,
  tweak: <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><circle cx="8" cy="8" r="3"/><circle cx="16" cy="16" r="3"/><path d="M3 8h2M11 8h10M3 16h10M19 16h2"/></svg>,
};

// ---------- Header ----------
const PAGE_LABEL = {
  "/": "GLOBAL FEED", "/region": "REGION DOSSIER", "/entities": "ENTITY GRAPH",
  "/trends": "TRENDS", "/admin": "SOURCES",
};
function Header({ lang, setLang, route, setRoute, tweaksOpen, setTweaksOpen, feedCount }) {
  const key = route.startsWith("/region") ? "/region" : route;
  return (
    <header className="app-header">
      <div className="header-brand">
        <BrandMark />
        <span className="brand-title">MAPR</span>
        <span className="brand-build">v4.12 · OSINT</span>
      </div>

      <div className="header-page">
        <span className="hp-label">{PAGE_LABEL[key] || ""}</span>
        {route === "/" && (
          <span className="hp-feed"><span className="hp-live"/> {feedCount} live · 24h</span>
        )}
      </div>

      <div className="header-right" style={{marginLeft:"auto"}}>
        <button className="lang-select" title="Language filter"
          onClick={() => {
            const opts = ["ALL","EN","FR","ES","DE","JA","ZH","AR","RU","PT"];
            const i = opts.indexOf(lang);
            setLang(opts[(i+1) % opts.length]);
          }}>
          LANG · <b style={{color:"var(--ink-0)"}}>{lang}</b>
        </button>
        <button className="toggle-chip" data-active={tweaksOpen}
          onClick={() => {
            setTweaksOpen(v => !v);
            if (!tweaksOpen) window.parent.postMessage({type:"__activate_edit_mode"}, "*");
            else window.parent.postMessage({type:"__deactivate_edit_mode"}, "*");
          }}>
          {Ico.tweak}&nbsp;TWEAKS
        </button>
        <div className="op-badge">
          <span className="op-dot"/> OPS · NOMINAL
        </div>
      </div>
    </header>
  );
}

// ---------- Sidebar ----------
const ROUTES = [
  { id: "/",         label: "MAP",      ico: Ico.map },
  { id: "/region",   label: "REGION",   ico: Ico.region },
  { id: "/entities", label: "ENTITIES", ico: Ico.entities },
  { id: "/trends",   label: "TRENDS",   ico: Ico.trend },
  { id: "/admin",    label: "ADMIN",    ico: Ico.admin },
];

function Sidebar({ route, setRoute }) {
  return (
    <aside className="app-sidebar">
      <nav className="side-nav">
        {ROUTES.map(r => (
          <button key={r.id}
            className="side-btn"
            data-active={route === r.id || (r.id === "/region" && route.startsWith("/region"))}
            onClick={() => setRoute(r.id === "/region" ? "/region/UKR" : r.id)}>
            {r.ico}
            <span className="side-label">{r.label}</span>
          </button>
        ))}
        <div className="side-spacer" />
      </nav>
    </aside>
  );
}

// ---------- Status bar ----------
function StatusBar({ events, lang }) {
  const [now, setNow] = useState2(new Date());
  useEffect2(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const nf = (d) => d.toISOString().replace("T"," ").slice(0,19) + "Z";
  const red = events.filter(e => e.tier === "red" || e.tier === "black").length;
  const amber = events.filter(e => e.tier === "amber").length;
  const green = events.filter(e => e.tier === "green").length;
  return (
    <div className="app-status">
      <div className="status-item">● <b>{nf(now)}</b></div>
      <div className="status-sep"/>
      <div className="status-item">FEED · <b>{events.length}</b> events/6h</div>
      <div className="status-item">RED <b style={{color:"var(--sev-red)"}}>{red}</b></div>
      <div className="status-item">AMBER <b style={{color:"var(--sev-amber)"}}>{amber}</b></div>
      <div className="status-item">GREEN <b style={{color:"var(--sev-green)"}}>{green}</b></div>
      <div className="status-sep"/>
      <div className="status-item">SRC · <b>312</b> online · <b style={{color:"var(--sev-amber)"}}>7</b> degraded</div>
      <div className="status-right">
        <div className="status-item">LANG · <b>{lang}</b></div>
        <div className="status-item">OP · <b>NOMINAL</b></div>
        <div className="status-item">⌥ + H · HELP</div>
      </div>
    </div>
  );
}

// ---------- News panel ----------
function NewsPanel({ events, activeEvent, onEventClick, lang }) {
  const filtered = lang === "ALL" ? events : events.filter(e => e.lang === lang.toLowerCase());
  const sorted = [...filtered].sort((a,b) => b.ts - a.ts);
  return (
    <div className="floating-panel news-panel">
      <div className="panel-header">
        <span className="dot"/>
        <span>FEED · LIVE</span>
        <span className="spacer"/>
        <span style={{color:"var(--ink-2)"}}>{sorted.length} items</span>
      </div>
      <div className="panel-body">
        {sorted.map(e => <NewsRow key={e.id} e={e} active={activeEvent === e.id} onClick={()=>onEventClick(e)} />)}
        {sorted.length === 0 && (
          <div style={{padding:24, textAlign:"center", color:"var(--ink-2)", fontFamily:"var(--ff-mono)", fontSize:11, letterSpacing:"0.1em"}}>
            NO ITEMS IN LANG · {lang}
          </div>
        )}
      </div>
    </div>
  );
}

function ago(ts) {
  const m = Math.floor((Date.now() - ts) / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m`;
  if (m < 1440) return `${Math.floor(m/60)}h`;
  return `${Math.floor(m/1440)}d`;
}

function NewsRow({ e, active, onClick }) {
  return (
    <div className="news-item" data-active={active} onClick={onClick}>
      <div className="news-meta">
        <span className={`sev-pill sev-${e.tier}`}>{e.tier.toUpperCase()}·{e.sev.toFixed(1)}</span>
        <span className="tag">{e.cat.toUpperCase()}</span>
        <span style={{marginLeft:"auto"}}>{e.lang.toUpperCase()}</span>
        <span>·</span>
        <span>{ago(e.ts)} ago</span>
      </div>
      <div className="news-title">{e.title}</div>
      <div className="news-src">
        <span className="mono">{e.id}</span> · {e.src} · {e.iso}
      </div>
    </div>
  );
}

// ---------- Side panels (anomaly, watchlist, narrative) ----------
function Sparkline({ data, color="var(--amber)", w=60, h=18 }) {
  const max = Math.max(...data), min = Math.min(...data);
  const rng = Math.max(1, max - min);
  const pts = data.map((v,i) => `${(i/(data.length-1))*w},${h - ((v-min)/rng)*h}`).join(" ");
  return (
    <svg width={w} height={h} className="anomaly-sparkline">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1" vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

function AnomalyPanel({ anomalies }) {
  return (
    <div className="mini-panel">
      <div className="panel-header"><span className="dot" style={{background:"var(--sev-red)"}}/>ANOMALY FEED<span className="spacer"/><span style={{color:"var(--ink-2)"}}>6H</span></div>
      <div className="panel-body">
        {anomalies.map((a,i) => (
          <div key={i} className="anomaly-row">
            <Sparkline data={a.data} color={a.dir === "up" ? "var(--sev-red)" : "var(--sev-green)"} w={34} h={16}/>
            <div>
              <div className="anomaly-label">{a.label}</div>
              <div style={{fontFamily:"var(--ff-mono)", fontSize:10, color:"var(--ink-2)", letterSpacing:"0.08em"}}>vs 14d baseline</div>
            </div>
            <div className={`anomaly-delta ${a.dir === "down" ? "neg" : ""}`}>{a.delta}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

function WatchlistPanel({ regions, onSelect }) {
  const top = [...regions].sort((a,b) => b.avg - a.avg).slice(0,6);
  return (
    <div className="mini-panel">
      <div className="panel-header"><span className="dot" style={{background:"var(--amber)"}}/>WATCHLIST<span className="spacer"/><span style={{color:"var(--ink-2)"}}>TOP·6</span></div>
      <div className="panel-body">
        {top.map(r => (
          <div key={r.iso} className="watchlist-row" onClick={() => onSelect(r.iso)}>
            <span className="code">{r.iso}</span>
            <span className="name">{r.name}</span>
            <span className="ct">{r.count}·<span style={{color: r.avg >= 6 ? "var(--sev-red)" : r.avg >= 4 ? "var(--sev-amber)" : "var(--sev-green)"}}>{r.avg.toFixed(1)}</span></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function NarrativePanel({ narratives }) {
  return (
    <div className="mini-panel">
      <div className="panel-header"><span className="dot" style={{background:"var(--cyan)"}}/>NARRATIVES<span className="spacer"/><span style={{color:"var(--ink-2)"}}>CLUSTERS</span></div>
      <div className="panel-body">
        {narratives.map(n => (
          <div key={n.id} className="narrative-row">
            <div className="title">{n.title}</div>
            <div className="sub">{n.id} · {n.sub}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- Filter drawer ----------
const CAT_OPTS = ["conflict","cyber","unrest","seismic","weather","economic","health","maritime","tech"];
const SEV_OPTS = [["green","0–3"],["amber","3–6"],["red","6–8"],["black","8+"]];

function FilterDrawer({ open, onClose, filters, setFilters, events }) {
  if (!open) return null;
  const countByCat = CAT_OPTS.map(c => events.filter(e => e.cat === c).length);
  const countBySev = SEV_OPTS.map(([t]) => events.filter(e => e.tier === t).length);
  return (
    <div className="floating-panel filter-drawer">
      <div className="panel-header">
        <span className="dot"/>FILTERS
        <span className="spacer"/>
        <button onClick={onClose}>{Ico.close}</button>
      </div>
      <div className="panel-body">
        <div className="filter-section">
          <span className="micro">Severity tier</span>
          <div className="chip-row">
            {SEV_OPTS.map(([t,label],i) => (
              <button key={t} className="chip" data-active={filters.sev.includes(t)}
                onClick={() => setFilters({...filters, sev: toggle(filters.sev, t)})}>
                {t.toUpperCase()} <span className="ct">{countBySev[i]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-section">
          <span className="micro">Category</span>
          <div className="chip-row">
            {CAT_OPTS.map((c,i) => (
              <button key={c} className="chip" data-active={filters.cat.includes(c)}
                onClick={() => setFilters({...filters, cat: toggle(filters.cat, c)})}>
                {c} <span className="ct">{countByCat[i]}</span>
              </button>
            ))}
          </div>
        </div>
        <div className="filter-section">
          <span className="micro">Score ≥ <b className="mono" style={{color:"var(--ink-0)"}}>{filters.minSev.toFixed(1)}</b></span>
          <div className="slider">
            <span style={{color:"var(--ink-2)"}}>0.0</span>
            <input type="range" min="0" max="10" step="0.1"
              value={filters.minSev}
              onChange={(e) => setFilters({...filters, minSev: parseFloat(e.target.value)})} />
            <span style={{color:"var(--ink-2)"}}>10.0</span>
          </div>
        </div>
        <div className="filter-section">
          <span className="micro">Time window</span>
          <div className="chip-row">
            {["15M","1H","6H","24H","72H","7D"].map(t => (
              <button key={t} className="chip" data-active={filters.window === t}
                onClick={() => setFilters({...filters, window: t})}>{t}</button>
            ))}
          </div>
        </div>
        <div className="filter-section">
          <span className="micro">Source tier</span>
          <div className="chip-row">
            {["WIRE","NEWS","GOV","NGO","SOCIAL"].map(t => (
              <button key={t} className="chip" data-active={filters.srcTier.includes(t)}
                onClick={() => setFilters({...filters, srcTier: toggle(filters.srcTier, t)})}>{t}</button>
            ))}
          </div>
        </div>
        <div className="filter-section" style={{display:"flex", gap:8, justifyContent:"flex-end"}}>
          <button className="btn" onClick={() => setFilters({ sev: [], cat: [], minSev: 0, window: "6H", srcTier: [] })}>RESET</button>
          <button className="btn primary" onClick={onClose}>APPLY</button>
        </div>
      </div>
    </div>
  );
}
function toggle(arr, v) { return arr.includes(v) ? arr.filter(x => x !== v) : [...arr, v]; }

// ---------- Timeline strip ----------
function Timeline({ events, cursor, setCursor, playing, setPlaying }) {
  const ref = useRef2(null);
  const W = 800, H = 40;
  // Bin events into 48 buckets over last 6h (= 7.5 min / bucket)
  const now = Date.now();
  const windowMs = 6 * 60 * 60 * 1000;
  const bins = useMemo2(() => {
    const buckets = new Array(48).fill(0).map(() => ({ g:0, a:0, r:0, b:0 }));
    for (const e of events) {
      const idx = Math.floor((1 - (now - e.ts) / windowMs) * 48);
      if (idx < 0 || idx >= 48) continue;
      const k = e.tier === "green" ? "g" : e.tier === "amber" ? "a" : e.tier === "red" ? "r" : "b";
      buckets[idx][k] += 1;
    }
    return buckets;
  }, [events]);
  const maxBin = Math.max(1, ...bins.map(b => b.g+b.a+b.r+b.b));

  // Auto-scrub if playing
  useEffect2(() => {
    if (!playing) return;
    const id = setInterval(() => {
      setCursor(c => (c + 1) % 48);
    }, 600);
    return () => clearInterval(id);
  }, [playing, setCursor]);

  const onTrackClick = (e) => {
    const rect = ref.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    setCursor(Math.max(0, Math.min(47, Math.floor((x / rect.width) * 48))));
  };

  const tNow = new Date(now);
  const tCur = new Date(now - (47 - cursor) / 48 * windowMs);

  return (
    <div className="timeline">
      <div className="timeline-label">
        <div className="t1">TIMELINE · 6H</div>
        <div className="t2">{tCur.toISOString().slice(11,19)}Z</div>
      </div>
      <div className="timeline-track" ref={ref} onClick={onTrackClick} style={{cursor:"pointer"}}>
        <svg width="100%" height="50" viewBox={`0 0 ${W} 50`} preserveAspectRatio="none">
          {/* Grid */}
          {[0,12,24,36,48].map(i => (
            <line key={i} x1={(i/48)*W} x2={(i/48)*W} y1={8} y2={42}
              stroke="var(--line)" strokeWidth="0.5" />
          ))}
          {/* Bins */}
          {bins.map((b,i) => {
            const total = b.g + b.a + b.r + b.b;
            if (total === 0) return null;
            const x = (i/48)*W;
            const bw = W/48 - 1;
            let y = 42;
            const parts = [
              ["g", b.g, "var(--sev-green)"],
              ["a", b.a, "var(--sev-amber)"],
              ["r", b.r, "var(--sev-red)"],
              ["b", b.b, "var(--sev-black)"],
            ];
            return parts.map(([k,v,color]) => {
              if (!v) return null;
              const hh = (v/maxBin) * 34;
              y -= hh;
              return <rect key={i+k} x={x+0.5} y={y} width={bw} height={hh} fill={color} opacity={i <= cursor ? 1 : 0.35}/>;
            });
          })}
          {/* Cursor */}
          <line x1={((cursor+0.5)/48)*W} x2={((cursor+0.5)/48)*W} y1={4} y2={46}
            stroke="var(--amber)" strokeWidth="1.2"/>
          <polygon points={`${((cursor+0.5)/48)*W - 4},2 ${((cursor+0.5)/48)*W + 4},2 ${((cursor+0.5)/48)*W},8`} fill="var(--amber)" />
        </svg>
        <div style={{display:"flex", justifyContent:"space-between", fontFamily:"var(--ff-mono)", fontSize:9, color:"var(--ink-3)", letterSpacing:"0.1em"}}>
          <span>−6H</span><span>−4H</span><span>−2H</span><span>NOW</span>
        </div>
      </div>
      <div className="timeline-ctrl">
        <button className="tl-btn" onClick={() => setCursor(Math.max(0, cursor - 1))}>‹</button>
        <button className="tl-btn" data-active={playing} onClick={() => setPlaying(!playing)}>{playing ? Ico.pause : Ico.play}</button>
        <button className="tl-btn" onClick={() => setCursor(Math.min(47, cursor + 1))}>›</button>
        <button className="tl-btn" onClick={() => { setCursor(47); setPlaying(false); }}>⏭</button>
      </div>
    </div>
  );
}

// ---------- Article sheet ----------
function ArticleSheet({ event, onClose }) {
  if (!event) return null;
  return (
    <>
      <div className="article-sheet-backdrop" onClick={onClose}/>
      <div className="article-sheet">
        <div className="panel-header" style={{height:"36px"}}>
          <span className="dot"/>EVENT · <span className="mono" style={{color:"var(--ink-0)"}}>{event.id}</span>
          <span className="spacer"/>
          <span style={{color:"var(--ink-2)"}}>{ago(event.ts)} ago</span>
          <button onClick={onClose} style={{marginLeft:12}}>{Ico.close}</button>
        </div>
        <div className="panel-body" style={{padding: "24px 28px"}}>
          <div style={{display:"flex", alignItems:"center", gap:10, marginBottom:16}}>
            <span className={`sev-pill sev-${event.tier}`} style={{padding:"3px 10px"}}>{event.tier.toUpperCase()} · SEV {event.sev.toFixed(1)}</span>
            <span className="mono" style={{color:"var(--ink-2)"}}>{event.cat.toUpperCase()} · {event.iso}</span>
            <span className="mono" style={{color:"var(--ink-2)", marginLeft:"auto"}}>{event.lon.toFixed(2)}, {event.lat.toFixed(2)}</span>
          </div>
          <h2 style={{fontFamily:"var(--ff-serif)", fontWeight:400, fontSize:22, lineHeight:1.25, margin:"0 0 16px"}}>{event.title}</h2>
          <p style={{color:"var(--ink-1)", lineHeight:1.55, fontSize:13, margin:"0 0 20px"}}>
            {event.summary || "No summary available. Analysts have not enriched this event with a full brief. Multi-source correlation in progress."}
          </p>

          <div style={{borderTop:"1px solid var(--line)", paddingTop:16, marginBottom:16}}>
            <div className="micro" style={{marginBottom:10}}>CORROBORATION · {event.src.split("·").length} SOURCES</div>
            {event.src.split("·").map((s,i) => (
              <div key={i} style={{display:"flex", gap:10, padding:"7px 0", borderBottom:"1px solid var(--line)", fontFamily:"var(--ff-mono)", fontSize:11}}>
                <span style={{color:"var(--sev-green)"}}>●</span>
                <span style={{color:"var(--ink-0)", flex:1}}>{s.trim()}</span>
                <span style={{color:"var(--ink-2)"}}>{Math.floor(Math.random()*30)+2}m ago</span>
                <span style={{color:"var(--ink-2)"}}>{(0.7 + Math.random()*0.28).toFixed(2)}</span>
              </div>
            ))}
          </div>

          <div>
            <div className="micro" style={{marginBottom:10}}>ENTITIES EXTRACTED</div>
            <div className="chip-row">
              {["ORG: CISA","LOC: Washington DC","ORG: UNC4841","EVT: CVE-2026-23181","DATE: 24h"].map(x => (
                <span key={x} className="chip" style={{cursor:"default"}}>{x}</span>
              ))}
            </div>
          </div>

          <div style={{marginTop:20, display:"flex", gap:8}}>
            <button className="btn primary">OPEN IN FOCUS</button>
            <button className="btn">ADD TO WATCHLIST</button>
            <button className="btn">EXPORT JSON</button>
          </div>
        </div>
      </div>
    </>
  );
}

window.MAPR_SHELL = {
  Header, Sidebar, StatusBar, NewsPanel, AnomalyPanel, WatchlistPanel, NarrativePanel,
  FilterDrawer, Timeline, ArticleSheet, Sparkline, Ico, ago,
};
