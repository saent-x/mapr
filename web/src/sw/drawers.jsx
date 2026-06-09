/* Drawers (Signals / Cases / Entities / Watches), Account modal, Cold-open */
import React from "react";
import { Link } from "react-router-dom";
import { MAPR } from "./data.js";
import { Icons } from "./icons.jsx";
import { useSignals, useEntities, useWatches, useCases } from "./api/hooks.js";
import { buildSignals, buildEntities, buildWatches, buildCases, ago } from "./api/adapters.js";

function Drawer({ title, subtitle, onClose, children }) {
  return (
    <>
      <div className="drawer-scrim" onClick={onClose} />
      <aside className="drawer">
        <div className="drawer-head">
          <div>
            <h2 className="serif">{title}</h2>
            <p>{subtitle}</p>
          </div>
          <button className="drawer-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="drawer-body scroll">{children}</div>
      </aside>
    </>
  );
}

function SignalsDrawer({ onClose, onScope, onChangeReport }) {
  const kindLabel = { anomaly: "ANOMALY", watch: "WATCH HIT", alert: "ALERT FIRED" };
  const { anomalies, fired, loading } = useSignals();
  const all = buildSignals(anomalies, fired);
  return (
    <Drawer title="Signals" subtitle="The push side — computed anomalies (recency-weighted movers over the owned corpus) and your fired watches. Each one starts an investigation."
      onClose={onClose}>
      {loading && all.length === 0 && <div className="empty">Computing signals…</div>}
      {!loading && all.length === 0 && <div className="empty">No movers above threshold in the current window.</div>}
      {all.map((s) => (
        <div className={"list-item tier-" + s.tier} key={s.id}
          onClick={() => onScope(s.kind === "watch" && s.iso2
            ? { kind: "REGION", label: s.scope, iso2: s.iso2, tier: s.tier }
            : { kind: "CATEGORY", label: s.scope, tier: s.tier })}>
          <span className="li-accent" />
          <div className="li-top">
            <span className="li-kind">{kindLabel[s.kind]}</span>
            <span className="li-spike">{ago(s.min)} ago</span>
          </div>
          <div className="li-title">{s.text}</div>
          <div className="li-detail">{s.detail}</div>
          <div className="li-foot">
            <span>{s.scope}</span>
            {s.kind === "watch" && s.watchlistItemId && <button className="tag" onClick={(e) => { e.stopPropagation(); onChangeReport && onChangeReport({ watchlistItemId: s.watchlistItemId, name: s.scope }); }}>View change report</button>}
          </div>
        </div>
      ))}
    </Drawer>
  );
}

function CasesDrawer({ onClose, onScope, onOpenCase, picked, onNewCase, onPromote }) {
  const list = useCases();
  const cases = buildCases(list);
  return (
    <Drawer title="Cases" subtitle="Resumable investigations. Re-opening replays its context and re-plots pinned evidence on the map."
      onClose={onClose}>
      <div className="drawer-cta" style={{ marginBottom: 14 }}>
        <button className="btn-block btn-ink" onClick={onNewCase}><Icons.Plus size={15} /> New case</button>
      </div>
      {picked && picked.size > 0 && (
        <div className="list-item" style={{ borderStyle: "dashed" }}>
          <div className="li-title serif">Current selection</div>
          <div className="li-detail">{picked.size} evidence row{picked.size > 1 ? "s" : ""} pinned from the open investigation — ready to promote to a case.</div>
          <div className="drawer-cta" style={{ margin: "10px 0 0" }}>
            <button className="btn-block btn-ink" style={{ height: 34 }} onClick={onPromote}><Icons.Pin size={14} /> Promote to case</button>
          </div>
        </div>
      )}
      {list && cases.length === 0 && <div className="empty">No cases yet — pin evidence from an investigation and promote it to a case (Pro).</div>}
      {cases.map((c) => (
        <div className={"list-item tier-" + c.tier} key={c.id} onClick={() => onOpenCase(c)}>
          <span className="li-accent" />
          <div className="li-top"><span className="li-kind">CASE</span><span className="li-spike">{ago(c.updatedMin)} ago</span></div>
          <div className="li-title serif">{c.title}</div>
          {c.description && <div className="li-detail">{c.description}</div>}
          <div className="li-foot">
            <span>{c.status}</span>
            <span style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 4 }}>OPEN <Icons.Chevron size={12} /></span>
          </div>
        </div>
      ))}
    </Drawer>
  );
}

function WatchesDrawer({ onClose, onChangeReport, onScope, onNewWatch }) {
  const items = useWatches();
  const watches = buildWatches(items);
  return (
    <Drawer title="Watches" subtitle="Standing watches snapshot a frozen baseline at creation, then diff the live corpus against it every cycle."
      onClose={onClose}>
      <div className="drawer-cta" style={{ marginBottom: 14 }}>
        <button className="btn-block btn-ink" onClick={onNewWatch}><Icons.Plus size={15} /> New watch</button>
      </div>
      {items && watches.length === 0 && <div className="empty">No watches yet — investigate a region and choose “Watch this scope” to freeze a baseline.</div>}
      {watches.map((w) => (
        <div className="list-item tier-red" key={w.id} onClick={() => onChangeReport({ watchlistItemId: w.id, name: w.name })}>
          <span className="li-accent" />
          <div className="li-top">
            <span className="li-kind">● LIVE WATCH</span>
            <span className="li-spike">{w.matchCount} hits</span>
          </div>
          <div className="li-title serif">{w.name}</div>
          <div className="li-detail">{w.scope}</div>
          <div className="li-foot">
            <span className="watch-stat">View baseline diff →</span>
            <span style={{ marginLeft: "auto" }}>frozen {ago(w.addedMin)} ago</span>
          </div>
        </div>
      ))}
    </Drawer>
  );
}

function EntitiesDrawer({ onClose, onDossier }) {
  const graph = useEntities();
  const ents = buildEntities(graph);
  return (
    <Drawer title="Entities" subtitle="People, orgs, and places extracted from the corpus, ranked by mentions. Open one as an in-context dossier."
      onClose={onClose}>
      {graph === undefined && <div className="empty">Resolving entities…</div>}
      {graph !== undefined && ents.length === 0 && <div className="empty">No entities in the current window.</div>}
      {ents.map((e) => (
        <div className={"list-item tier-" + e.tier} key={e.name} onClick={() => onDossier(e)}>
          <span className="li-accent" />
          <div className="li-top"><span className="li-kind">{e.type}</span><span className="li-spike">{e.mentions} mentions</span></div>
          <div className="li-title serif">{e.name}</div>
          {e.cooccur.length > 0 && <div className="li-detail">Co-occurs with {e.cooccur.slice(0, 2).join(", ")}</div>}
        </div>
      ))}
    </Drawer>
  );
}

function AccountModal({ onClose, plan, onUpgrade }) {
  const freeFeatures = [
    [true, "Full chat + bidirectional map scoping (Context Stack)"],
    [true, "Investigation cards with computed source-strength"],
    [true, "Reproducible, frozen-provenance citations"],
    [true, "Create watches + in-app “NEW since baseline” markers"],
    [true, "Computed Trends & Entities views"],
    [false, "Baseline Diff Reports (full change synthesis)"],
    [false, "Living cases, exports, correlation tracer"],
  ];
  const proFeatures = [
    [true, "Everything in Free, unmetered"],
    [true, "Baseline Diff Reports + scheduled email digests"],
    [true, "Unmetered standing watches & automated diffs"],
    [true, "Living cases — map-restoring, exportable"],
    [true, "Correlation tracer & escalation chronology"],
    [true, "Shared boards (share + fork)"],
    [true, "Self-hosted — every query stays on your box"],
  ];
  return (
    <div className="modal-scrim" onClick={onClose}>
      <div className="modal scroll" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="serif">Your watchdesk</h2>
            <p>You're on the <b>{plan === "pro" ? "Pro" : "Free"}</b> plan. Free proves the corpus is real; Pro sells the continuous, frozen, computed, sovereign workflow.</p>
          </div>
          <button className="drawer-close" onClick={onClose}><Icons.X size={16} /></button>
        </div>
        <div className="plans">
          <div className="plan">
            <h3>Free</h3>
            <div className="price">$0<small> / forever</small></div>
            <div className="tag-line">Prove the map, corpus, and provenance are real.</div>
            <ul>
              {freeFeatures.map(([on, t], i) => (
                <li key={i} className={on ? "" : "muted"}>{on ? <Icons.Check size={15} /> : <Icons.Lock size={15} />}<span>{t}</span></li>
              ))}
            </ul>
            <button className="plan-cta btn-ghost" disabled style={{ opacity: .6 }}>{plan === "pro" ? "Included" : "Current plan"}</button>
          </div>
          <div className="plan pro">
            <h3>Pro</h3>
            <div className="price">$39<small> / mo</small></div>
            <div className="tag-line">Persistence, automation, and sovereignty — what a search-LLM structurally can't be.</div>
            <ul>
              {proFeatures.map(([on, t], i) => (
                <li key={i}><Icons.Check size={15} /><span>{t}</span></li>
              ))}
            </ul>
            <button className="plan-cta btn-ink" onClick={onUpgrade}>{plan === "pro" ? "Manage subscription" : "Upgrade to Pro"}</button>
          </div>
        </div>
        <div className="modal-foot-link">
          <Link to="/account">Full account &amp; billing settings <span aria-hidden="true">→</span></Link>
        </div>
      </div>
    </div>
  );
}

function ColdOpen({ onStart, onDismiss }) {
  return (
    <div className="cold">
      <div className="cold-card">
        <span className="eyebrow">mapr · standing watch · live</span>
        <h1 className="serif">It already noticed something.</h1>
        <p>Ask in plain English, point at the map, and get a source-cited intelligence product back — over a corpus you own and watch over time, not the open web.</p>
        <div className="cold-actions">
          <button className="cold-btn btn-ink" onClick={() => onStart(MAPR.sampleAnswer.query)}>
            <Icons.Sparkle size={17} /> Investigate the Sudan surge
          </button>
          <button className="cold-btn btn-ghost" onClick={onDismiss}>Explore the map</button>
        </div>
      </div>
    </div>
  );
}

export { Drawer, SignalsDrawer, CasesDrawer, WatchesDrawer, EntitiesDrawer, AccountModal, ColdOpen };
