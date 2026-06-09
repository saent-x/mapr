/* Cards: the answer is an intelligence product, never a chat bubble. */
import React from "react";
import { MAPR } from "./data.js";
import { Icons } from "./icons.jsx";
import { CorroborationLattice, EntityGraph } from "./features.jsx";
import { splitAnswer, Markdown } from "./api/answer.jsx";
import { useTrends, useDossier, useDiffWatch } from "./api/hooks.js";
import { buildTrends, buildDossier, buildDiff, ago } from "./api/adapters.js";
const { useState: useStateC } = React;

function Sparkline({ values, color }) {
  const w = 200, h = 30, pad = 3;
  const max = Math.max(...values), min = Math.min(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => {
    const x = pad + (i / (values.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / span) * (h - pad * 2);
    return [x, y];
  });
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const area = d + ` L${pts[pts.length-1][0].toFixed(1)} ${h} L${pts[0][0].toFixed(1)} ${h} Z`;
  return (
    <svg className="spark" viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none">
      <path d={area} fill="var(--tc)" opacity="0.10" />
      <path d={d} fill="none" stroke="var(--tc)" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[pts.length-1][0]} cy={pts[pts.length-1][1]} r="2.6" fill="var(--tc)" />
    </svg>
  );
}

function SecLabel({ children }) {
  return <div className="sec-label"><span className="t">{children}</span><span className="ln" /></div>;
}

function EvidenceRow({ ev, n, picked, onPick, onHover, onClick }) {
  const T = MAPR.TIERS[ev.tier];
  return (
    <div className={"ev tier-" + ev.tier + (picked ? " picked" : "")}
      onMouseEnter={() => onHover(ev.id)} onMouseLeave={() => onHover(null)} onClick={() => onClick && onClick(ev)}>
      <span className="cite">{n}</span>
      <div className="ev-main">
        <div className="ev-top">
          <span className="pill">{T.label} · {ev.score.toFixed(1)}</span>
          {ev.sourceType === "social"
            ? <span className="ev-meta badge-social">SOCIAL · UNVERIFIED</span>
            : ev.verified ? <span className="ev-meta badge-verified">✓ VERIFIED</span> : null}
        </div>
        <div className="ev-title">{ev.title}</div>
        <div className="ev-meta">
          <span>{ev.category}</span><span>·</span><span>{ev.iso2}</span><span>·</span>
          <span>{MAPR.ago(ev.ageMin)} ago</span><span>·</span><span>{ev.source}</span>
        </div>
        <div className="ev-prov mono">
          <span className="prov-pin" title="Immutable snapshot pinned at ingest"><Icons.Lock size={10} /> snapshot {MAPR.ago(ev.snapshotMin)} ago</span>
          <span className="prov-sep">·</span>
          <span title={ev.contentHash}>{ev.contentHash}</span>
          {ev.corroboration > 1 && <><span className="prov-sep">·</span><span className="prov-corr">{ev.corroboration}× corroborated</span></>}
          {ev.textChanged && <span className="prov-changed" title="Source text was edited after we captured it"><Icons.Alert size={10} /> source edited since capture</span>}
        </div>
      </div>
      <button className="ev-check" onClick={(e) => { e.stopPropagation(); onPick(ev.id); }} title="Pin to case">
        <Icons.Check size={12} />
      </button>
    </div>
  );
}

function StrengthStrip({ s }) {
  const tier = s.level === "HIGH" ? "green" : s.level === "MODERATE" ? "amber" : "red";
  const on = s.level === "HIGH" ? 4 : s.level === "MODERATE" ? 3 : 2;
  return (
    <div className={"strength tier-" + tier}>
      <div className="strength-bars">{[0,1,2,3].map(i => <i key={i} className={i < on ? "on" : ""} />)}</div>
      <span className="lvl">{s.level}</span>
      <span className="meta">
        <span>{s.sources} sources</span><span className="dot" />
        <span>{s.verified} verified</span><span className="dot" />
        <span>{s.social} social</span>
      </span>
      <span className="note">{s.note}</span>
    </div>
  );
}

function InvestigationCard({ ans, picked, onPick, onHover, onMove, onEvClick }) {
  const evs = ans.evidence ?? (ans.evidenceIds || []).map(id => MAPR.byId[id]).filter(Boolean);
  const { lead, body } = splitAnswer(ans.answerMarkdown || ans.bottomLine || "");
  return (
    <div className="card tier-black">
      <div className="card-q">
        <span className="qk">ASK</span>
        <span className="qt">{ans.query}</span>
      </div>
      <div className="card-body">
        {lead && <div className="bottomline serif">{lead}</div>}
        {body && <div className="answer-prose"><Markdown text={body} /></div>}
        <StrengthStrip s={ans.strength} />
        {ans.facts && ans.facts.length > 0 && (
          <div>
            <SecLabel>Computed facts</SecLabel>
            <div className="facts" style={{ marginTop: 9 }}>
              {ans.facts.map((f, i) => (
                <div className="fact" key={i}>
                  <div className="fl">{f.label}</div>
                  <div className="fv">{f.value}</div>
                  {f.sub && <div className={"fs" + (f.sub.includes("+") ? " up" : "")}>{f.sub}</div>}
                </div>
              ))}
            </div>
          </div>
        )}
        {evs.length > 0 && (
          <div>
            <SecLabel>Cited evidence</SecLabel>
            <div className="ev-list" style={{ marginTop: 9 }}>
              {evs.map((ev, i) => (
                <EvidenceRow key={ev.id} ev={ev} n={i + 1} picked={picked.has(ev.id)}
                  onPick={onPick} onHover={onHover} onClick={onEvClick} />
              ))}
            </div>
          </div>
        )}
        {ans.whatChanged && (
          <div className="changed">
            <span className="ic"><Icons.Trend size={18} /></span>
            <div className="ct"><b>What changed —</b> {ans.whatChanged}</div>
          </div>
        )}
        {ans.corroboration && <CorroborationLattice data={ans.corroboration} />}
        <div>
          <SecLabel>Next moves</SecLabel>
          <div className="moves" style={{ marginTop: 9 }}>
            <button className="move primary" onClick={() => onMove("watch")}><Icons.Eye size={14} /> Watch this scope</button>
            <button className="move" onClick={() => onMove("case")}><Icons.Pin size={14} /> Pin to case</button>
            <button className="move" onClick={() => onMove("alert")}><Icons.Bell size={14} /> Set alert</button>
            <button className="move" onClick={() => onMove("brief")}>Generate brief <span className="lock">PRO</span></button>
            <button className="move" onClick={() => onMove("export")}><Icons.Download size={14} /> Export <span className="lock">PRO</span></button>
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendsCard({ onMove }) {
  const series = useTrends();
  const t = series ? buildTrends(series) : null;
  return (
    <div className="card">
      <div className="card-q"><span className="qk">COMPUTED</span><span className="qt">What's moving — severity activity, last 7 days</span></div>
      <div className="card-body">
        {!t ? (
          <><div className="shimmer-line" /><div className="shimmer-line" style={{ width: "72%" }} /><div className="shimmer-line" style={{ width: "55%" }} /></>
        ) : (
          <>
            <div className="bottomline serif" style={{ fontSize: 17 }}>{t.bottomLine}</div>
            <div style={{ marginTop: 2 }}>
              {t.rows.map((s) => (
                <div className={"trend-row tier-" + s.color} key={s.cat}>
                  <div className="trend-cat">{s.cat.toLowerCase()}</div>
                  <Sparkline values={s.values} />
                  <div className="trend-delta">{s.delta >= 0 ? "+" : ""}{s.delta}%</div>
                </div>
              ))}
            </div>
            <div className="baseline-meta">Deterministic counts over the owned corpus · reproducible · not a forecast</div>
            <div className="moves">
              <button className="move primary" onClick={() => onMove("watch")}><Icons.Eye size={14} /> Watch top mover</button>
              <button className="move" onClick={() => onMove("export")}><Icons.Download size={14} /> Export series <span className="lock">PRO</span></button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function ChangeReportCard({ watch, onMove }) {
  const raw = useDiffWatch(watch.watchlistItemId);
  const w = raw ? buildDiff(raw, watch.name) : null;
  if (!w) {
    return (
      <div className="card tier-red">
        <div className="card-q"><span className="qk">DIFF</span><span className="qt">Change report — “{watch.name}” since baseline</span></div>
        <div className="card-body"><div className="shimmer-line" /><div className="shimmer-line" style={{ width: "68%" }} /><div className="shimmer-line" style={{ width: "44%" }} /></div>
      </div>
    );
  }
  return (
    <div className="card tier-red">
      <div className="card-q"><span className="qk">DIFF</span><span className="qt">Change report — “{w.name}” since baseline</span></div>
      <div className="card-body">
        <div className="bottomline serif" style={{ fontSize: 17 }}>
          {w.newCount} new and {w.escalated} escalated events crossed your frozen baseline.
        </div>
        <div className="diff-grid">
          <div className="diff-cell new"><div className="n">+{w.newCount}</div><div className="l">New</div></div>
          <div className="diff-cell esc"><div className="n">{w.escalated}</div><div className="l">Escalated</div></div>
          <div className="diff-cell"><div className="n">{w.resolved}</div><div className="l">Resolved</div></div>
        </div>
        <div className="changed">
          <span className="ic"><Icons.Clock size={18} /></span>
          <div className="ct"><b>Baseline frozen</b> {ago(w.baselineMin)} ago at {w.baselineCount} events. Now {w.nowCount}. The diff is computed deterministically over the owned corpus — a stateless search cannot reproduce this reference point.</div>
        </div>
        <div className="moves">
          <button className="move primary" onClick={() => onMove("openmap")}><Icons.Map size={14} /> Show new events on map</button>
          <button className="move" onClick={() => onMove("brief")}>Synthesize report <span className="lock">PRO</span></button>
          <button className="move" onClick={() => onMove("rebaseline")}><Icons.Refresh size={14} /> Re-baseline</button>
        </div>
      </div>
    </div>
  );
}

function DossierCard({ entity, onMove, onHover }) {
  const raw = useDossier(entity.name);
  const dos = raw ? buildDossier(raw, entity.name) : null;
  if (!dos) {
    return (
      <div className={"card tier-" + (entity.tier || "amber")}>
        <div className="card-q"><span className="qk">DOSSIER</span><span className="qt">{entity.name} — entity lens</span></div>
        <div className="card-body"><div className="shimmer-line" /><div className="shimmer-line" style={{ width: "70%" }} /><div className="shimmer-line" style={{ width: "52%" }} /></div>
      </div>
    );
  }
  const g = dos.graph;
  return (
    <div className={"card tier-" + dos.tier}>
      <div className="card-q"><span className="qk">DOSSIER</span><span className="qt">{dos.name} — entity lens</span></div>
      <div className="card-body">
        <div className="facts">
          <div className="fact"><div className="fl">Events (7d)</div><div className="fv">{dos.mentions}</div></div>
          <div className="fact"><div className="fl">Active regions</div><div className="fv">{dos.regions.slice(0, 4).join(" · ") || "—"}</div></div>
          <div className="fact"><div className="fl">Co-occurs with</div><div className="fv">{dos.cooccur.slice(0, 2).join(" · ") || "—"}</div></div>
        </div>
        {g.nodes.length > 1 && (
          <div>
            <SecLabel>Co-occurrence graph</SecLabel>
            <div className="egraph-wrap" style={{ marginTop: 6 }}><EntityGraph graph={g} /></div>
          </div>
        )}
        {dos.evidence.length > 0 && (
          <div>
            <SecLabel>Recent linked reports</SecLabel>
            <div className="ev-list" style={{ marginTop: 9 }}>
              {dos.evidence.map((ev, i) => <EvidenceRow key={ev.id} ev={ev} n={i + 1} picked={new Set()} onPick={() => {}} onHover={onHover} />)}
            </div>
          </div>
        )}
        <div className="baseline-meta">Co-occurrence weighted over the owned corpus · deterministic</div>
        <div className="moves">
          <button className="move primary" onClick={() => onMove("watch")}><Icons.Eye size={14} /> Watch this entity</button>
          <button className="move" onClick={() => onMove("correlate")}><Icons.Link size={14} /> Trace correlations <span className="lock">PRO</span></button>
        </div>
      </div>
    </div>
  );
}

export { Sparkline, InvestigationCard, TrendsCard, ChangeReportCard, DossierCard, SecLabel, EvidenceRow, StrengthStrip };
