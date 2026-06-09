/* New differentiator features:
   #4 TimeScrubber · #5 CorroborationLattice · #7 EntityGraph
   #8 FeedsDrawer · #9 CaseCard (audit trail) */
import React from "react";
import { MAPR } from "./data.js";
import { Icons } from "./icons.jsx";
import { Sparkline, SecLabel, EvidenceRow } from "./cards.jsx";
import { Drawer } from "./drawers.jsx";
import { useCase, useFeeds, useSourceRequest } from "./api/hooks.js";
import { buildCaseDetail, buildFeeds, ago } from "./api/adapters.js";
const { useState: uSF, useEffect: uEF, useRef: uRF } = React;

/* ---------- #4 Escalation rewind: time-scrubber ---------- */
const REWIND_WINDOW = 600; // 10h — matches the corpus's oldest first-seen, so playback fills the track
function TimeScrubber({ threshold, onChange, onClose }) {
  const [playing, setPlaying] = uSF(false);
  const raf = uRF(null);
  const val = threshold == null ? 0 : threshold; // minutes-ago; 0 = now

  uEF(() => {
    if (!playing) return;
    let cur = REWIND_WINDOW;
    onChange(cur);
    let last = performance.now();
    const step = (now) => {
      const dt = now - last; last = now;
      cur -= dt * 0.09; // ~6.5s sweep
      if (cur <= 0) { cur = 0; onChange(0); setPlaying(false); setTimeout(() => onChange(null), 400); return; }
      onChange(cur);
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => raf.current && cancelAnimationFrame(raf.current);
  }, [playing]);

  const label = val === 0 ? "NOW · live" : "AS OF −" + MAPR.ago(Math.round(val)) + " ago";
  const shownCount = MAPR.events.filter(e => e.ageMin >= (threshold == null ? 0 : threshold)).length;

  return (
    <div className="scrubber">
      <button className={"scrub-play" + (playing ? " on" : "")} onClick={() => setPlaying(p => !p)}>
        {playing ? <span className="pause-ic" /> : <span className="play-ic" />}
      </button>
      <div className="scrub-meta">
        <span className="scrub-eyebrow eyebrow">Escalation rewind</span>
        <span className="scrub-asof mono">{label}</span>
      </div>
      <div className="scrub-track">
        <input className="scrub-range" type="range" min="0" max={REWIND_WINDOW} step="5"
          value={REWIND_WINDOW - val}
          onChange={(e) => { setPlaying(false); const v = REWIND_WINDOW - (+e.target.value); onChange(v <= 5 ? null : v); }} />
        <div className="scrub-ticks">
          <span>−10h</span><span>−7h</span><span>−5h</span><span>−2h</span><span>now</span>
        </div>
      </div>
      <span className="scrub-count mono">{shownCount} events</span>
      <button className="scrub-close" onClick={onClose}><Icons.X size={15} /></button>
    </div>
  );
}

/* ---------- #5 Corroboration lattice ---------- */
function CorroborationLattice({ data }) {
  const stanceColor = { corroborates: "green", contradicts: "red", single: "amber" };
  const indep = data.sources.filter(s => s.independent && s.stance === "corroborates").length;
  return (
    <div>
      <SecLabel>Corroboration</SecLabel>
      <div className="corr" style={{ marginTop: 9 }}>
        <div className="corr-claim">“{data.claim}”</div>
        <div className="corr-lattice">
          {data.sources.map((s, i) => (
            <div className={"corr-node tier-" + stanceColor[s.stance]} key={i} title={s.stance}>
              <span className="corr-line" />
              <span className="corr-dot" />
              <span className="corr-name">{s.name}</span>
              <span className="corr-type mono">{s.type}{s.independent ? "" : " · linked"}</span>
            </div>
          ))}
        </div>
        <div className="corr-verdict">
          <b className="mono">{indep}× independent</b> {data.verdict}
        </div>
      </div>
    </div>
  );
}

/* ---------- #7 Entity knowledge graph ---------- */
function EntityGraph({ graph }) {
  const W = 300, H = 210, cx = W / 2, cy = H / 2;
  const center = graph.nodes.find(n => n.self) || graph.nodes[0];
  const outer = graph.nodes.filter(n => !n.self);
  const pos = { [center.id]: [cx, cy] };
  outer.forEach((n, i) => {
    const a = (i / outer.length) * Math.PI * 2 - Math.PI / 2;
    pos[n.id] = [cx + Math.cos(a) * 86, cy + Math.sin(a) * 70];
  });
  const maxW = Math.max(...graph.edges.map(e => e[2]));
  return (
    <svg className="egraph" viewBox={`0 0 ${W} ${H}`}>
      {graph.edges.map((e, i) => {
        const a = pos[e[0]], b = pos[e[1]];
        if (!a || !b) return null;
        return <line key={i} x1={a[0]} y1={a[1]} x2={b[0]} y2={b[1]}
          stroke="var(--hairline-2)" strokeWidth={0.8 + (e[2] / maxW) * 2.6} opacity="0.8" />;
      })}
      {graph.nodes.map((n) => {
        const p = pos[n.id]; if (!p) return null;
        const r = n.self ? 22 : 6 + (n.weight / center.weight) * 12;
        return (
          <g key={n.id} transform={`translate(${p[0]},${p[1]})`}>
            <circle r={r} fill={n.self ? "var(--ink)" : "var(--surface)"} stroke={n.self ? "var(--ink)" : "var(--hairline-2)"} strokeWidth="1.4" />
            <text y={n.self ? 4 : -r - 5} textAnchor="middle"
              fontSize={n.self ? 11 : 10} fontWeight={n.self ? 700 : 500}
              fill={n.self ? "var(--paper)" : "var(--ink-2)"}
              fontFamily="var(--sans)">{n.label}</text>
          </g>
        );
      })}
    </svg>
  );
}

/* ---------- #8 Feeds drawer ---------- */
function FeedsDrawer({ onClose, toast }) {
  const raw = useFeeds();
  const feeds = buildFeeds(raw);
  const submit = useSourceRequest();
  const [name, setName] = uSF("");
  const [url, setUrl] = uSF("");
  const [open, setOpen] = uSF(false);
  const owned = feeds.filter((f) => f.owned).length;
  const doRequest = async () => {
    if (!name.trim() || !url.trim()) { toast && toast("Source name and URL are required"); return; }
    try {
      await submit({ name: name.trim(), url: url.trim(), reason: "Requested via the Feeds drawer" });
      toast && toast("Source requested — an admin will review it");
      setOpen(false); setName(""); setUrl("");
    } catch (e) {
      const m = String(e?.message || e || "");
      if (/FEATURE_LOCKED|FEATURE_LIMIT/i.test(m)) toast && toast("Requesting custom sources is a Pro feature — upgrade to add your own.");
      else toast && toast("Could not submit the request.");
    }
  };
  return (
    <Drawer title="Feeds" subtitle="The corpus is yours. These sources are ingested on your box and never leave it; request your own private wires to add to it." onClose={onClose}>
      <div className="sov-banner">
        <Icons.Lock size={15} />
        <span><b>Self-hosted ingest.</b> {feeds.length} active source{feeds.length === 1 ? "" : "s"}{owned > 0 ? ` · ${owned} yours` : ""} · queries never touch a third-party API.</span>
      </div>
      <div className="drawer-cta" style={{ marginBottom: 12 }}>
        <button className="btn-block btn-ink" onClick={() => setOpen((o) => !o)}><Icons.Plus size={15} /> Request a source</button>
      </div>
      {open && (
        <div style={{ padding: "0 16px 12px", display: "flex", flexDirection: "column", gap: 8 }}>
          <input className="inp" placeholder="Source name (e.g. Kyiv Independent)" value={name} onChange={(e) => setName(e.target.value)} />
          <input className="inp" placeholder="Feed URL" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-primary btn-sm" onClick={doRequest}>Submit request</button>
        </div>
      )}
      {raw === undefined && <div className="empty">Loading sources…</div>}
      {raw && feeds.length === 0 && <div className="empty">No sources enabled yet — an admin can add them on the Admin page.</div>}
      {feeds.map((f) => (
        <div className="feed-item" key={f.id}>
          <div className="feed-main">
            <div className="li-top">
              <span className={"feed-type" + (f.owned ? " owned" : "")}>{f.type}</span>
              {f.owned && <span className="feed-yours">YOURS</span>}
              <span className={"feed-health " + f.health}>{f.health === "ok" ? "● healthy" : "▲ " + (f.note || "lagging")}</span>
            </div>
            <div className="feed-name">{f.name}</div>
            <div className="feed-foot mono">{f.itemCount.toLocaleString()} items ingested</div>
          </div>
        </div>
      ))}
    </Drawer>
  );
}

/* ---------- #9 Shared case card with audit trail ---------- */
function CaseCard({ caseId, onMove, onHover }) {
  const raw = useCase(caseId);
  const cd = raw ? buildCaseDetail(raw) : null;
  if (!cd) {
    return (
      <div className="card tier-black">
        <div className="card-q"><span className="qk">CASE</span><span className="qt">Case — shared board</span></div>
        <div className="card-body"><div className="shimmer-line" /><div className="shimmer-line" style={{ width: "70%" }} /></div>
      </div>
    );
  }
  return (
    <div className="card tier-black">
      <div className="card-q"><span className="qk">CASE</span><span className="qt">{cd.title} — shared board</span></div>
      <div className="card-body">
        <div className="case-note serif">{cd.note}</div>
        {cd.evidence.length > 0 && (
          <div>
            <SecLabel>Pinned evidence · frozen</SecLabel>
            <div className="ev-list" style={{ marginTop: 9 }}>
              {cd.evidence.map((ev, i) => <EvidenceRow key={ev.id} ev={ev} n={i + 1} picked={new Set()} onPick={() => {}} onHover={onHover} />)}
            </div>
          </div>
        )}
        {cd.audit.length > 0 && (
          <div>
            <SecLabel>Forensic audit trail</SecLabel>
            <div className="audit" style={{ marginTop: 9 }}>
              {cd.audit.map((a, i) => (
                <div className="audit-row" key={i}>
                  <span className="audit-dot" />
                  <span className="audit-who">{a.who}</span>
                  <span className="audit-act">{a.action}</span>
                  <span className="audit-min mono">{ago(a.min)} ago</span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="moves">
          <button className="move primary" onClick={() => onMove("export")}><Icons.Download size={14} /> Export brief <span className="lock">PRO</span></button>
          <button className="move" onClick={() => onMove("share")}><Icons.Link size={14} /> Share board</button>
          <button className="move" onClick={() => onMove("openmap")}><Icons.Map size={14} /> Restore on map</button>
        </div>
      </div>
    </div>
  );
}

export { TimeScrubber, CorroborationLattice, EntityGraph, FeedsDrawer, CaseCard, REWIND_WINDOW };
