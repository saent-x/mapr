import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useConvex, useConvexAuth } from "convex/react";
import { anyApi } from "convex/server";
import "./workspace.css";

function sevTier(severity) {
  if (severity >= 8) return "black";
  if (severity >= 6) return "red";
  if (severity >= 4) return "amber";
  return "green";
}

function Empty({ children }) {
  return <p className="ws-empty">{children}</p>;
}
function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}


function WatchlistSection() {
  const convex = useConvex();
  const items = useQuery(anyApi.watchlist.list, {});
  const add = useMutation(anyApi.watchlist.add);
  const remove = useMutation(anyApi.watchlist.remove);
  const [type, setType] = useState("region");
  const [value, setValue] = useState("");
  const [label, setLabel] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!value.trim()) return;
    await add({ type, value: value.trim(), label: label.trim() || value.trim() });
    setValue("");
    setLabel("");
  };

  return (
    <div className="card">
      {items === undefined ? (
        <Empty>Loading…</Empty>
      ) : items.length === 0 ? (
        <Empty>No watchlist entries yet. Add a region, entity, or keyword below.</Empty>
      ) : (
        <div className="ws-list">
          {items.map((it) => (
            <WatchlistRow key={it._id} item={it} onRemove={() => remove({ id: it._id })} convex={convex} />
          ))}
        </div>
      )}
      <form className="ws-form" onSubmit={submit}>
        <div className="field">
          <label>Type</label>
          <select value={type} onChange={(e) => setType(e.target.value)}>
            <option value="region">region</option>
            <option value="entity">entity</option>
            <option value="keyword">keyword</option>
          </select>
        </div>
        <div className="field">
          <label>Value</label>
          <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={type === "region" ? "UA" : "search value"} />
        </div>
        <div className="field">
          <label>Label</label>
          <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" />
        </div>
        <button className="btn primary" type="submit">Add</button>
      </form>
    </div>
  );
}

function WatchlistRow({ item, onRemove, convex }) {
  const [status, setStatus] = useState(null);
  const run = async (action) => {
    setStatus(`${action}…`);
    try {
      if (action === "brief") {
        await convex.mutation(anyApi.briefs.generate, { scopeType: "watchlist", scopeValue: String(item._id), windowHours: 24 });
        setStatus("Brief saved");
      } else {
        const data = await convex.query(anyApi.briefs.whatChanged, { scopeType: "watchlist", scopeValue: String(item._id), since: Date.now() - 24 * 3_600_000 });
        setStatus(data.summary);
      }
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required" : "Action failed");
    }
  };
  return (
    <div className="ws-row">
      <div className="grow">
        <div className="name">{item.label}</div>
        <div className="sub">
          <span>{item.type}</span>
          <span>{item.value}</span>
        </div>
        {status && <p>{status}</p>}
      </div>
      <button className="btn sm" onClick={() => run("change")}>What changed</button>
      <button className="btn sm" onClick={() => run("brief")}>Brief</button>
      <button className="btn sm danger" onClick={onRemove}>Remove</button>
    </div>
  );
}

function AlertsSection() {
  const items = useQuery(anyApi.alerts.list, {});
  const create = useMutation(anyApi.alerts.create);
  const setActive = useMutation(anyApi.alerts.setActive);
  const remove = useMutation(anyApi.alerts.remove);
  const [name, setName] = useState("");
  const [threshold, setThreshold] = useState(7);
  const [email, setEmail] = useState("");

  const submit = async (e) => {
    e.preventDefault();
    if (!name.trim()) return;
    const args = { name: name.trim(), severityThreshold: Number(threshold) };
    if (email.trim()) {
      args.emailAddress = email.trim();
      args.channels = ["email"];
    }
    await create(args);
    setName("");
    setThreshold(7);
    setEmail("");
  };

  return (
    <div className="card">
      {items === undefined ? (
        <Empty>Loading…</Empty>
      ) : items.length === 0 ? (
        <Empty>No alert rules yet. Create one to get notified above a severity threshold.</Empty>
      ) : (
        <div className="ws-list">
          {items.map((a) => (
            <div className="ws-row" key={a._id}>
              <button
                className="toggle"
                aria-pressed={a.active}
                title={a.active ? "Active — click to pause" : "Paused — click to activate"}
                onClick={() => setActive({ id: a._id, active: !a.active })}
              />
              <div className="grow">
                <div className="name">{a.name}</div>
                <div className="sub">
                  <span>≥ sev {a.severityThreshold}</span>
                  {a.emailAddress && <span>{a.emailAddress}</span>}
                  <span className={a.active ? "ok" : "warn"}>{a.active ? "active" : "paused"}</span>
                </div>
              </div>
              <button className="btn sm danger" onClick={() => remove({ id: a._id })}>Remove</button>
            </div>
          ))}
        </div>
      )}
      <form className="ws-form" onSubmit={submit}>
        <div className="field">
          <label>Name</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Black-tier Europe" />
        </div>
        <div className="field">
          <label>Severity ≥</label>
          <input type="number" min="0" max="10" step="0.5" value={threshold} onChange={(e) => setThreshold(e.target.value)} />
        </div>
        <div className="field">
          <label>Email (optional)</label>
          <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@agency.gov" />
        </div>
        <button className="btn primary" type="submit">Create</button>
      </form>
    </div>
  );
}

function BookmarksSection() {
  const items = useQuery(anyApi.bookmarks.list, {});
  const toggle = useMutation(anyApi.bookmarks.toggle);

  return (
    <div className="card">
      {items === undefined ? (
        <Empty>Loading…</Empty>
      ) : items.length === 0 ? (
        <Empty>No bookmarks yet. Save stories from the map or event view.</Empty>
      ) : (
        <div className="ws-list">
          {items.map((b) => {
            const tier = sevTier(b.severity);
            return (
              <div className="ws-row" key={b._id}>
                <span className={`sev-pill sev-${tier}`}>{tier.toUpperCase()} · {Number(b.severity).toFixed(1)}</span>
                <div className="grow">
                  <div className="name">
                    {b.url ? (
                      <a href={b.url} target="_blank" rel="noreferrer">{b.storyTitle}</a>
                    ) : (
                      b.storyTitle
                    )}
                  </div>
                  <div className="sub">
                    <span>{b.region}</span>
                    {b.source && <span>{b.source}</span>}
                  </div>
                </div>
                <button
                  className="btn sm danger"
                  onClick={() =>
                    toggle({
                      storyId: b.storyId,
                      storyTitle: b.storyTitle,
                      region: b.region,
                      severity: b.severity,
                    })
                  }
                >
                  Remove
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function SavedViewRow({ view, onRemove, convex }) {
  const [status, setStatus] = useState(null);
  const run = async (action) => {
    setStatus(`${action}…`);
    try {
      if (action === "brief") {
        await convex.mutation(anyApi.briefs.generate, { scopeType: "savedView", scopeValue: String(view._id), windowHours: 24 });
        setStatus("Brief saved");
      } else {
        const data = await convex.query(anyApi.briefs.whatChanged, { scopeType: "savedView", scopeValue: String(view._id), since: Date.now() - 24 * 3_600_000 });
        setStatus(data.summary);
      }
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required" : "Action failed");
    }
  };
  return (
    <div className="ws-row">
      <div className="grow">
        <div className="name">{view.name}</div>
        {view.description && <div className="sub"><span style={{ textTransform: "none", letterSpacing: 0 }}>{view.description}</span></div>}
        {status && <p>{status}</p>}
      </div>
      <button className="btn sm" onClick={() => run("change")}>What changed</button>
      <button className="btn sm" onClick={() => run("brief")}>Brief</button>
      <button className="btn sm danger" onClick={onRemove}>Remove</button>
    </div>
  );
}

function SavedViewsSection() {
  const convex = useConvex();
  const items = useQuery(anyApi.savedViews.list, {});
  const remove = useMutation(anyApi.savedViews.remove);

  return (
    <div className="card">
      {items === undefined ? (
        <Empty>Loading…</Empty>
      ) : items.length === 0 ? (
        <Empty>No saved views yet. Save a map filter configuration to revisit it later.</Empty>
      ) : (
        <div className="ws-list">
          {items.map((view) => (
            <SavedViewRow key={view._id} view={view} onRemove={() => remove({ id: view._id })} convex={convex} />
          ))}
        </div>
      )}
    </div>
  );
}

function BriefsSection() {
  const convex = useConvex();
  const items = useQuery(anyApi.briefs.list, { limit: 50 });
  const remove = useMutation(anyApi.briefs.remove);
  const [status, setStatus] = useState(null);
  const exportBrief = async (id, title) => {
    setStatus("Exporting…");
    try {
      const md = await convex.query(anyApi.exports.briefMarkdown, { id });
      downloadText(`${title.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`, md, "text/markdown");
      setStatus("Brief exported");
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required for exports" : "Could not export brief");
    }
  };
  return (
    <div className="card">
      <h2>Briefs</h2>
      <p className="event-summary">Saved analyst briefs generated from the map, watchlists, regions, or cases.</p>
      {status && <div className="inline-status">{status}</div>}
      <div className="ws-list">
        {(items ?? []).map((item) => (
          <div key={item._id} className="ws-row">
            <div className="grow">
              <div className="name">{item.title}</div>
              <div className="sub">{new Date(item.createdAt).toLocaleString()} · {item.scopeType}{item.scopeValue ? `:${item.scopeValue}` : ""}</div>
              <p>{item.summary}</p>
            </div>
            <button className="btn sm" onClick={() => exportBrief(item._id, item.title)}>Export</button>
            <button className="btn sm danger" onClick={() => remove({ id: item._id })}>Remove</button>
          </div>
        ))}
        {items?.length === 0 && <Empty>No saved briefs yet. Generate one from the map Composer or a region panel.</Empty>}
      </div>
    </div>
  );
}

function CasesSection() {
  const convex = useConvex();
  const items = useQuery(anyApi.cases.list, {});
  const create = useMutation(anyApi.cases.create);
  const archive = useMutation(anyApi.cases.archive);
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setStatus("Creating…");
    try {
      await create({ title, description: "Created from workspace." });
      setTitle("");
      setStatus("Case created");
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required for case files" : "Could not create case");
    }
  };
  const exportCase = async (id, name) => {
    setStatus("Exporting…");
    try {
      const md = await convex.query(anyApi.exports.caseMarkdown, { id });
      downloadText(`${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.md`, md, "text/markdown");
      setStatus("Case exported");
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required for exports" : "Could not export case");
    }
  };
  return (
    <div className="card">
      <h2>Cases</h2>
      <p className="event-summary">Case files collect map events, notes, regions, and generated briefs into exportable analyst work product.</p>
      <form className="ws-form" onSubmit={submit}>
        <input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Case title" required />
        <button className="btn primary" type="submit">Create case</button>
      </form>
      {status && <div className="inline-status">{status}</div>}
      <div className="ws-list">
        {(items ?? []).map((item) => (
          <div key={item._id} className="ws-row">
            <div className="grow">
              <div className="name">{item.title}</div>
              <div className="sub">{item.status} · updated {new Date(item.updatedAt).toLocaleString()}</div>
              {item.description && <p>{item.description}</p>}
            </div>
            <button className="btn sm" onClick={() => exportCase(item._id, item.title)}>Export</button>
            <button className="btn sm" onClick={() => archive({ id: item._id, archived: item.status !== "archived" })}>{item.status === "archived" ? "Restore" : "Archive"}</button>
          </div>
        ))}
        {items?.length === 0 && <Empty>No cases yet. Add an event to a case from the map, or create one here.</Empty>}
      </div>
    </div>
  );
}

function SourceRequestsSection() {
  const items = useQuery(anyApi.sourceRequests.listMine, {});
  const submitRequest = useMutation(anyApi.sourceRequests.submit);
  const [form, setForm] = useState({ name: "", url: "", reason: "", region: "", category: "" });
  const [status, setStatus] = useState(null);
  const submit = async (e) => {
    e.preventDefault();
    setStatus("Submitting…");
    try {
      await submitRequest({
        name: form.name,
        url: form.url,
        reason: form.reason,
        region: form.region || undefined,
        category: form.category || undefined,
      });
      setForm({ name: "", url: "", reason: "", region: "", category: "" });
      setStatus("Source request queued for admin review");
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required for custom source requests" : "Could not submit source request");
    }
  };
  return (
    <div className="card">
      <h2>Custom sources</h2>
      <p className="event-summary">Pro users can request regional feeds for admin review. Approved sources enter the normal source-health and ingestion pipeline.</p>
      <form className="ws-form" onSubmit={submit}>
        <input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Source name" required />
        <input value={form.url} onChange={(e) => setForm((f) => ({ ...f, url: e.target.value }))} placeholder="RSS or site URL" required />
        <input value={form.region} onChange={(e) => setForm((f) => ({ ...f, region: e.target.value.toUpperCase() }))} placeholder="Region ISO, optional" />
        <input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} placeholder="Category, optional" />
        <input value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} placeholder="Why this source matters" required />
        <button className="btn primary" type="submit">Request source</button>
      </form>
      {status && <div className="inline-status">{status}</div>}
      <div className="ws-list">
        {(items ?? []).map((item) => (
          <div key={item._id} className="ws-row">
            <div>
              <b>{item.name}</b>
              <p>{item.url}</p>
              {item.adminNote && <p>{item.adminNote}</p>}
            </div>
            <span className="micro">{item.status}</span>
          </div>
        ))}
        {items?.length === 0 && <Empty>No source requests yet.</Empty>}
      </div>
    </div>
  );
}

const TABS = [
  { key: "watchlist", label: "Watchlist", Comp: WatchlistSection },
  { key: "alerts", label: "Alerts", Comp: AlertsSection },
  { key: "bookmarks", label: "Bookmarks", Comp: BookmarksSection },
  { key: "views", label: "Saved views", Comp: SavedViewsSection },
  { key: "briefs", label: "Briefs", Comp: BriefsSection },
  { key: "cases", label: "Cases", Comp: CasesSection },
  { key: "sources", label: "Sources", Comp: SourceRequestsSection },
];

export default function WorkspacePage() {
  const { isAuthenticated, isLoading } = useConvexAuth();
  const [tab, setTab] = useState("watchlist");

  return (
    <div className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="micro">
          <Link to="/">← Map</Link>
        </div>
        <div className="ws-head">
          <h1 className="serif ws-title">Workspace</h1>
        </div>

        {isLoading ? (
          <div className="card">Loading…</div>
        ) : !isAuthenticated ? (
          <div className="card">
            <h2>Sign in required</h2>
            <p className="event-summary">
              Your watchlist, alerts, bookmarks, and saved views are tied to your account.
            </p>
            <Link className="btn primary" to="/account" style={{ alignSelf: "flex-start" }}>
              Go to account
            </Link>
          </div>
        ) : (
          <>
            <div className="ws-tabs">
              {TABS.map((t) => (
                <button key={t.key} aria-pressed={tab === t.key} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            {TABS.map((t) => (tab === t.key ? <t.Comp key={t.key} /> : null))}
          </>
        )}
      </div>
    </div>
  );
}
