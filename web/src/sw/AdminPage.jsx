/* Admin — ingestion health, source catalog, feature flags, source requests.
   All live from Convex admin.* (requireAdmin server-side). Nothing mocked. */
import React from "react";
import { useNavigate } from "react-router-dom";
import { usePageTheme, useToasts, Switch, PageBar } from "./pageshell.jsx";
import { Icons } from "./icons.jsx";
import { useMe, useAdminHealth, useAdminFlags, useAdminRequests, useAdminActions } from "./api/hooks.js";
import { ago, TIERS } from "./api/adapters.js";
const { useState: uSAd } = React;

const ADM_TABS = [
  { k: "health", label: "Health", icon: Icons.Activity },
  { k: "sources", label: "Sources", icon: Icons.Database },
  { k: "flags", label: "Flags", icon: Icons.Flag },
  { k: "requests", label: "Requests", icon: Icons.Inbox },
];

function HealthTab({ health, actions, toast }) {
  if (!health) return <div className="empty">Loading ingestion health…</div>;
  const tc = health.tierCount || { green: 0, amber: 0, red: 0, black: 0 };
  const total = tc.green + tc.amber + tc.red + tc.black;
  return (
    <>
      <div className="section">
        <div className="section-bar"><h2>Ingestion health</h2><span className="ln" />
          <button className="act" onClick={async () => { try { await actions.requestRefresh({}); toast("Refresh requested — ingestor will sweep next poll"); } catch (e) { toast("Could not request refresh"); } }}><Icons.Refresh size={14} /> Request refresh</button>
        </div>
        <div className="stats">
          <div className="stat"><div className="sl"><Icons.Activity size={13} /> Events · 6h</div><div className="sv">{health.events6h}</div><div className="sx">located + scored</div></div>
          <div className="stat"><div className="sl"><Icons.Database size={13} /> Sources</div><div className="sv">{health.sources.enabled}<span style={{ fontSize: 14, color: "var(--ink-faint)" }}>/{health.sources.total}</span></div><div className="sx">enabled · fetched each cycle</div><span className="stat-dot ok" /></div>
          <div className="stat"><div className="sl"><Icons.Alert size={13} /> Degraded</div><div className="sv">{health.sources.degraded}</div><div className="sx">{health.sources.degraded > 0 ? "sources failing" : "all healthy"}</div><span className={"stat-dot " + (health.sources.degraded > 0 ? "warn" : "ok")} /></div>
          <div className="stat"><div className="sl"><Icons.Sparkle size={13} /> Local model</div><div className="sv" style={{ fontSize: 19, paddingTop: 4 }}>READY</div><div className="sx">qwen2.5:3b · bge-m3 (1024d)</div><span className="stat-dot ok" /></div>
        </div>
      </div>

      <div className="section">
        <div className="section-bar"><h2>Severity mix · last 6h</h2><span className="ln" /></div>
        <div className="tier-ribbon">
          {["green", "amber", "red", "black"].map((k) => (
            <div className={"seg " + k} key={k} style={{ flex: Math.max(0.6, tc[k]) }}>
              {tc[k]} {TIERS[k].label}
            </div>
          ))}
        </div>
        <div className="baseline-meta" style={{ marginTop: 10 }}>{total} located events scored deterministically by the ingestor in the last 6h · {tc.black} black-tier</div>
      </div>
    </>
  );
}

function SourcesTab({ health, actions, toast }) {
  const [adding, setAdding] = uSAd(false);
  const [name, setName] = uSAd("");
  const [url, setUrl] = uSAd("");
  const rows = health?.sourceRows || [];
  const add = async () => {
    if (!name.trim() || !url.trim()) { toast("Name and feed URL are required"); return; }
    try { await actions.addSource({ name: name.trim(), url: url.trim(), kind: "rss" }); toast("Source added · enabled"); setAdding(false); setName(""); setUrl(""); }
    catch (e) { toast("Could not add the source"); }
  };
  return (
    <div className="section">
      <div className="section-bar"><h2>Source catalog · {rows.length}</h2><span className="ln" />
        <button className="act" onClick={() => setAdding((a) => !a)}><Icons.Plus size={14} /> Add source</button>
      </div>
      {adding && (
        <div className="panel panel-pad" style={{ marginBottom: 14 }}>
          <div className="cols-even">
            <div className="field"><label>Name</label><input className="inp" placeholder="Kyiv Independent" value={name} onChange={(e) => setName(e.target.value)} /></div>
            <div className="field"><label>Feed URL (RSS)</label><input className="inp" placeholder="https://kyivindependent.com/feed" value={url} onChange={(e) => setUrl(e.target.value)} /></div>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
            <button className="btn btn-primary btn-sm" onClick={add}>Add to catalog</button>
            <button className="btn btn-outline btn-sm" onClick={() => setAdding(false)}>Cancel</button>
          </div>
        </div>
      )}
      <div className="panel tbl-scroll">
        <table className="tbl">
          <thead><tr><th>Source</th><th>Kind</th><th>Status</th><th className="num">Items</th><th>Last fetch</th><th></th><th></th></tr></thead>
          <tbody>
            {rows.map((s) => {
              const sev = s.consecutiveFailures === 0 ? "ok" : s.consecutiveFailures < 5 ? "warn" : "bad";
              return (
                <tr key={s.id} className={s.enabled ? "" : "row-off"}>
                  <td><div className="nm">{s.name}</div><div className="sub">{s.url}</div></td>
                  <td><span className="kind-pill">{s.kind}</span></td>
                  <td><span className="status-cell"><span className={"d " + sev} />{s.lastStatus}{s.consecutiveFailures > 0 && <span className="muted"> · {s.consecutiveFailures} fail</span>}</span></td>
                  <td className="num">{(s.itemCount || 0).toLocaleString()}</td>
                  <td className="sub">{s.lastFetchedAt ? ago(Math.round((Date.now() - s.lastFetchedAt) / 60000)) + " ago" : "never"}</td>
                  <td><Switch on={s.enabled} onClick={async () => { try { await actions.setSourceEnabled({ id: s.id, enabled: !s.enabled }); } catch (e) { toast("Could not toggle source"); } }} /></td>
                  <td><button className="icon-btn danger" onClick={async () => { try { await actions.removeSource({ id: s.id }); toast("Source removed"); } catch (e) { toast("Could not remove"); } }}><Icons.Trash size={15} /></button></td>
                </tr>
              );
            })}
            {rows.length === 0 && <tr><td colSpan={7} className="sub" style={{ textAlign: "center", padding: 24 }}>No sources in the catalog yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function FlagsTab({ flags, actions, toast }) {
  return (
    <div className="section">
      <div className="section-bar"><h2>Feature flags</h2><span className="ln" /><span className="act" style={{ pointerEvents: "none" }}>public-readable</span></div>
      <div className="panel panel-pad">
        {!flags && <div className="empty">Loading…</div>}
        {flags && flags.length === 0 && <div className="empty">No feature flags defined on this instance.</div>}
        {(flags || []).map((f) => (
          <div className="setrow" key={f._id || f.key}>
            <span className="si"><Icons.Flag size={17} /></span>
            <div className="sc"><div className="st">{f.key} {f.description && <span className="mono" style={{ fontSize: 10, color: "var(--ink-faint)" }}>· {f.description}</span>}</div></div>
            <Switch on={f.value} onClick={async () => { try { await actions.setFeatureFlag({ key: f.key, value: !f.value, description: f.description }); toast(`${f.key} ${f.value ? "disabled" : "enabled"}`); } catch (e) { toast("Could not update flag"); } }} />
          </div>
        ))}
      </div>
    </div>
  );
}

function RequestsTab({ requests, actions, toast }) {
  const pending = (requests || []).filter((r) => r.status === "pending");
  return (
    <div className="section">
      <div className="section-bar"><h2>Source requests · {pending.length} pending</h2><span className="ln" /></div>
      {!requests && <div className="empty">Loading…</div>}
      {requests && requests.length === 0 && <div className="empty">No analyst source requests.</div>}
      {(requests || []).map((r) => (
        <div className="panel panel-pad req-card" key={r._id}>
          <div className="req-top">
            <div><div className="nm" style={{ fontSize: 14 }}>{r.name}</div><div className="sub">{r.url}</div></div>
            <span className={"req-status " + r.status}>{r.status}</span>
          </div>
          <p className="req-reason">“{r.reason}”</p>
          <div className="req-foot">
            <span className="sub">{ago(Math.round((Date.now() - r.createdAt) / 60000))} ago</span>
            {r.status === "pending" && (
              <span className="req-actions">
                <button className="btn btn-outline btn-sm" onClick={async () => { try { await actions.reviewRequest({ id: r._id, status: "rejected" }); toast("Request dismissed"); } catch (e) { toast("Failed"); } }}>Dismiss</button>
                <button className="btn btn-primary btn-sm" onClick={async () => { try { await actions.reviewRequest({ id: r._id, status: "approved" }); toast("Approved → added to catalog"); } catch (e) { toast("Failed"); } }}><Icons.Check size={14} /> Approve</button>
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function AdminPage() {
  const [theme, setTheme] = usePageTheme();
  const [tab, setTab] = uSAd("health");
  const [toast, toastNode] = useToasts();
  const navigate = useNavigate();
  const me = useMe();
  const isAdmin = me?.role === "admin";
  const health = useAdminHealth(isAdmin);
  const flags = useAdminFlags();
  const requests = useAdminRequests(isAdmin);
  const actions = useAdminActions();

  if (me === undefined) {
    return <div className="page"><div className="pbody"><div className="pwrap"><div className="page-head"><h1 className="serif">Loading…</h1></div></div></div></div>;
  }
  if (!isAdmin) {
    return (
      <div className="page">
        <PageBar theme={theme} setTheme={setTheme} />
        <div className="pbody"><div className="pwrap"><div className="page-head">
          <span className="eyebrow">Instance administration</span>
          <h1 className="serif">Admins only</h1>
          <p>This instance’s admin surface manages the source catalog, feature flags, and ingestion health. Ask your operator to add your email to <code>ADMIN_EMAILS</code>.</p>
        </div>
          <button className="btn btn-primary btn-sm" onClick={() => navigate("/")}>← Back to console</button>
        </div></div>
        {toastNode}
      </div>
    );
  }

  return (
    <div className="page">
      <PageBar theme={theme} setTheme={setTheme} tabs={ADM_TABS} active={tab} onTab={setTab} user />
      <div className="pbody">
        <div className="pwrap">
          <div className="page-head">
            <span className="eyebrow">Instance administration</span>
            <h1 className="serif">Watchdesk control</h1>
            <p>Ingestion health, the defined source set, feature flags, and analyst source requests — everything that keeps the owned corpus real and reproducible.</p>
          </div>
          {tab === "health" && <HealthTab health={health} actions={actions} toast={toast} />}
          {tab === "sources" && <SourcesTab health={health} actions={actions} toast={toast} />}
          {tab === "flags" && <FlagsTab flags={flags} actions={actions} toast={toast} />}
          {tab === "requests" && <RequestsTab requests={requests} actions={actions} toast={toast} />}
        </div>
      </div>
      {toastNode}
    </div>
  );
}

export default AdminPage;
