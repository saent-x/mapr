import { useState } from "react";
import { useQuery, useMutation } from "convex/react";
import { anyApi } from "convex/server";
import "./workspace.css";

function HealthKpis({ health }) {
  return (
    <div className="kpis">
      <div className="kpi">
        <div className="k">Sources</div>
        <div className="v tnum">{health.sources.enabled}/{health.sources.total}</div>
      </div>
      <div className="kpi">
        <div className="k">Degraded</div>
        <div className="v tnum" style={{ color: health.sources.degraded ? "var(--sev-amber)" : "var(--ink-0)" }}>
          {health.sources.degraded}
        </div>
      </div>
      <div className="kpi">
        <div className="k">Events 6h</div>
        <div className="v tnum">{health.events6h}</div>
      </div>
      <div className="kpi">
        <div className="k">Red/Amber</div>
        <div className="v tnum">
          {health.tierCount.red + health.tierCount.black}/{health.tierCount.amber}
        </div>
      </div>
    </div>
  );
}

function AddSource() {
  const addSource = useMutation(anyApi.admin.addSource);
  const [form, setForm] = useState({ name: "", url: "", kind: "rss" });
  const submit = (e) => {
    e.preventDefault();
    if (!form.name || !form.url) return;
    addSource(form).then(() => setForm({ name: "", url: "", kind: "rss" }));
  };
  return (
    <form className="card" onSubmit={submit}>
      <h2>Add source</h2>
      <div className="field">
        <label>Name</label>
        <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
      </div>
      <div className="field">
        <label>URL</label>
        <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://…" />
      </div>
      <div className="field">
        <label>Kind</label>
        <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
          <option value="rss">RSS</option>
          <option value="gdelt">GDELT</option>
          <option value="html">HTML</option>
        </select>
      </div>
      <button className="btn primary" type="submit" style={{ alignSelf: "flex-start" }}>
        Add
      </button>
    </form>
  );
}

function SourceRequestQueue() {
  const requests = useQuery(anyApi.sourceRequests.listAdmin, { status: "pending" });
  const review = useMutation(anyApi.sourceRequests.review);
  return (
    <div className="card">
      <h2>Source requests</h2>
      {(requests ?? []).map((req) => (
        <div key={req._id} className="ws-row">
          <div>
            <b>{req.name}</b>
            <p>{req.url}</p>
            <p>{req.reason}</p>
            <div className="micro">{req.region || "GLOBAL"} · {req.category || "general"}</div>
          </div>
          <div style={{ display: "flex", gap: 6 }}>
            <button className="chip" onClick={() => review({ id: req._id, status: "approved", approveAsSource: true, adminNote: "Approved into source catalog disabled for review." })}>Approve</button>
            <button className="chip" onClick={() => review({ id: req._id, status: "rejected", adminNote: "Rejected by admin." })}>Reject</button>
          </div>
        </div>
      ))}
      {requests?.length === 0 && <p className="event-summary">No pending source requests.</p>}
    </div>
  );
}


export default function AdminPage() {
  const me = useQuery(anyApi.users.me, {});
  const isAdmin = me?.role === "admin";
  // Only subscribe to the admin-gated query once we know the user is an admin
  // (Convex "skip" avoids an UNAUTHENTICATED error for signed-out visitors).
  const health = useQuery(anyApi.admin.health, isAdmin ? {} : "skip");
  const requestRefresh = useMutation(anyApi.admin.requestRefresh);
  const setEnabled = useMutation(anyApi.admin.setSourceEnabled);
  const [refreshed, setRefreshed] = useState(false);

  if (me === undefined) {
    return (
      <div className="page">
        <div className="page-narrow">
          <div className="card">Loading…</div>
        </div>
      </div>
    );
  }
  if (!me || me.role !== "admin") {
    return (
      <div className="page">
        <div className="page-narrow">
          <div className="card">
            <h2>Admin</h2>
            <p className="event-summary">Admin access required. Sign in with an admin account.</p>
          </div>
        </div>
      </div>
    );
  }
  if (health === undefined) {
    return (
      <div className="page">
        <div className="page-narrow">
          <div className="card">Loading ingestion health…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-narrow" style={{ maxWidth: 860 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <h2 className="serif" style={{ flex: 1 }}>Ingestion control</h2>
          <button
            className="btn"
            onClick={() => requestRefresh().then(() => { setRefreshed(true); setTimeout(() => setRefreshed(false), 2500); })}
          >
            {refreshed ? "Refresh queued ✓" : "Request refresh"}
          </button>
        </div>
        <HealthKpis health={health} />
        <div className="card">
          <h2>Sources</h2>
          <table className="src-table">
            <thead>
              <tr>
                <th>Source</th>
                <th>Kind</th>
                <th>Status</th>
                <th>Items</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {health.sourceRows.map((s) => (
                <tr key={s.id}>
                  <td>
                    {s.name}
                    <div className="micro">{s.url}</div>
                  </td>
                  <td className="mono">{s.kind}</td>
                  <td className={s.lastStatus === "ok" ? "ok" : s.lastStatus === "err" ? "err" : "warn"}>
                    {s.lastStatus}
                    {s.consecutiveFailures > 0 ? ` (${s.consecutiveFailures})` : ""}
                  </td>
                  <td className="mono tnum">{s.itemCount}</td>
                  <td>
                    <button className="chip" onClick={() => setEnabled({ id: s.id, enabled: !s.enabled })}>
                      {s.enabled ? "Disable" : "Enable"}
                    </button>
                  </td>
                </tr>
              ))}
              {health.sourceRows.length === 0 && (
                <tr>
                  <td colSpan={5} className="micro" style={{ padding: 14 }}>
                    No sources yet — add one below.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <SourceRequestQueue />
        <AddSource />
      </div>
    </div>
  );
}
