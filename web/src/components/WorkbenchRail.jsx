import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useConvex, useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";

const TABS = [
  { key: "watching", label: "Watching" },
  { key: "alerts", label: "Alerts" },
  { key: "briefs", label: "Briefs" },
  { key: "cases", label: "Cases" },
];

function ago(ts) {
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

function isPaid(me) {
  return me?.tier === "pro" || me?.tier === "admin" || me?.isPro;
}

function scopeName(regionDossier, iso, event) {
  if (event && iso) return `${regionDossier?.name ?? iso} event scope`;
  if (event) return "Open news item";
  if (iso) return regionDossier?.name ?? iso;
  return "Global live feed";
}

function statusFromError(err, fallback) {
  const msg = String(err?.message || err);
  if (msg.includes("FEATURE")) return "This is a Pro workflow. Upgrade to save it.";
  if (msg.includes("FORBIDDEN")) return "Sign in again to save this.";
  return fallback;
}

export default function WorkbenchRail({ selectedIso, activeEvent, events, onPickRegion, onOpenEvent, onNeedAuth }) {
  const [tab, setTab] = useState("watching");
  const [status, setStatus] = useState(null);
  const [watchForm, setWatchForm] = useState({ type: "region", value: "", label: "" });
  const me = useQuery(anyApi.users.me, {});
  const watching = useQuery(anyApi.watchlist.list, {}) ?? [];
  const alerts = useQuery(anyApi.alerts.list, {}) ?? [];
  const briefs = useQuery(anyApi.briefs.list, { limit: 6 }) ?? [];
  const cases = useQuery(anyApi.cases.list, {}) ?? [];
  const scopeIso = activeEvent?.isoA2 ?? selectedIso ?? null;
  const regionDossier = useQuery(anyApi.regions.dossier, scopeIso ? { iso: scopeIso } : "skip");
  const briefPreview = useQuery(anyApi.briefs.preview, { scopeType: scopeIso ? "region" : "global", scopeValue: scopeIso ?? undefined, windowHours: 24 });
  const alertPreview = useQuery(anyApi.alerts.preview, {
    severityThreshold: 6,
    isoA2: scopeIso ?? undefined,
    category: activeEvent?.category,
    windowHours: 168,
  });
  const addWatch = useMutation(anyApi.watchlist.add);
  const removeWatch = useMutation(anyApi.watchlist.remove);
  const createAlert = useMutation(anyApi.alerts.create);
  const setAlertActive = useMutation(anyApi.alerts.setActive);
  const generateBrief = useMutation(anyApi.briefs.generate);
  const createCase = useMutation(anyApi.cases.create);
  const addCaseItem = useMutation(anyApi.cases.addItem);
  const convex = useConvex();
  const paid = isPaid(me);
  const scopeLabel = scopeName(regionDossier, scopeIso, activeEvent);
  const recentEvents = useMemo(() => {
    const scoped = scopeIso ? events.filter((event) => event.isoA2 === scopeIso) : events;
    return scoped.slice(0, 4);
  }, [events, scopeIso]);

  const requireAuth = () => {
    if (me === null) {
      onNeedAuth?.();
      return false;
    }
    return true;
  };

  const run = async (pending, fallback, fn) => {
    if (!requireAuth()) return null;
    setStatus(pending);
    try {
      const result = await fn();
      setStatus(null);
      return result;
    } catch (err) {
      setStatus(statusFromError(err, fallback));
      return null;
    }
  };

  const trackScope = () => {
    if (!scopeIso) {
      setStatus("Pick a region first, or add a region, entity, or keyword below.");
      return;
    }
    return run(
      `Adding ${scopeLabel} to Watching...`,
      "Could not add this region to Watching.",
      () => addWatch({
        type: "region",
        value: scopeIso,
        label: regionDossier?.name ?? scopeIso,
        digestSchedule: paid ? { cadence: "daily", hourUTC: 8 } : undefined,
      }),
    );
  };

  const submitWatch = async (e) => {
    e.preventDefault();
    const value = watchForm.value.trim();
    if (!value) return;
    const label = watchForm.label.trim() || value;
    const type = watchForm.type;
    const normalizedValue = type === "region" ? value.toUpperCase() : value;
    const result = await run(
      `Adding ${label} to Watching...`,
      "Could not add this watch.",
      () => addWatch({ type, value: normalizedValue, label }),
    );
    if (result) setWatchForm({ type, value: "", label: "" });
  };

  const makeAlert = () => run(
    "Creating alert rule...",
    "Could not create this alert.",
    () => createAlert({
      name: activeEvent
        ? `${activeEvent.isoA2 || "Global"} ${activeEvent.category} red-tier alert`
        : `${scopeIso ? regionDossier?.name ?? scopeIso : "Global"} red-tier alert`,
      severityThreshold: 6,
      isoA2: scopeIso ?? undefined,
      category: activeEvent?.category,
      channels: ["email"],
      digestSchedule: { cadence: "daily", hourUTC: 8 },
    }),
  );

  const makeBrief = async () => {
    const result = await run(
      "Saving cited brief...",
      "Could not create this brief.",
      () => generateBrief({ scopeType: scopeIso ? "region" : "global", scopeValue: scopeIso ?? undefined, windowHours: 24 }),
    );
    if (result) setTab("briefs");
  };

  const exportScope = () => run(
    "Preparing CSV export...",
    "Could not export this scope.",
    async () => {
      const csv = await convex.query(anyApi.exports.eventsCsv, { isoA2: scopeIso ?? undefined, windowHours: 168 });
      const blob = new Blob([csv], { type: "text/csv" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${scopeIso ? scopeIso.toLowerCase() : "global"}-events.csv`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      return true;
    },
  );

  const addEventToCase = () => {
    if (!activeEvent) {
      setStatus("Open a news item first, then add it to a case file.");
      return;
    }
    return run(
      "Adding event to case...",
      "Could not add this event to a case.",
      async () => {
        const caseId = cases[0]?._id ?? await createCase({ title: `${activeEvent.isoA2 || "Global"} watch`, description: "Created from the map workbench." });
        await addCaseItem({
          caseId,
          type: "event",
          eventId: activeEvent._id,
          title: activeEvent.title,
          summary: activeEvent.summary,
          source: activeEvent.source,
          url: activeEvent.url,
          region: activeEvent.isoA2,
          severity: activeEvent.severity,
        });
        setTab("cases");
        return true;
      },
    );
  };

  return (
    <aside className="workbench-rail" aria-label="Map workbench">
      <div className="rail-head">
        <div>
          <div className="micro">Map workbench</div>
          <h2>{scopeLabel}</h2>
        </div>
        <Link to="/workspace" className="rail-link">Library</Link>
      </div>

      <section className="rail-scope-card">
        <div className="scope-line">
          <span className="scope-dot" data-live="true" />
          <span>{scopeIso ? `${scopeIso} scope` : "Global scope"}</span>
          <b>{briefPreview?.eventCount ?? events.length} events in 24h</b>
        </div>
        <p>
          {scopeIso
            ? `Actions below apply to ${regionDossier?.name ?? scopeIso}: watching stores the region, alerts email you on red-tier movement, briefs save a cited 24h dossier.`
            : "Pick a region or news item to narrow the workbench. You can still brief or export the global feed from here."}
        </p>
        {activeEvent && <p className="scope-note">Open item: similar alerts use this region and category.</p>}
      </section>

      <div className="rail-action-stack">
        <button className="rail-action" onClick={trackScope} disabled={!scopeIso}>
          <span>Track this region</span>
          <small>{scopeIso ? "Adds it to Watching on this map" : "Select a region first"}</small>
        </button>
        <button className="rail-action" data-locked={!paid} onClick={makeAlert}>
          <span>Create red-tier alert</span>
          <small>{alertPreview === undefined ? "Checking matches" : `${alertPreview.count} matching events this week`}</small>
        </button>
        <button className="rail-action primary" data-locked={!paid} onClick={makeBrief}>
          <span>Create 24h brief</span>
          <small>Saved with citations and source confidence</small>
        </button>
        <button className="rail-action" data-locked={!paid} onClick={addEventToCase}>
          <span>Add open item to case</span>
          <small>{activeEvent ? "Stores the news item as evidence" : "Open news first"}</small>
        </button>
        <button className="rail-action" data-locked={!paid} onClick={exportScope}>
          <span>Export source CSV</span>
          <small>Downloads the current scope</small>
        </button>
      </div>

      {status && <div className="rail-status">{status}</div>}

      <form className="rail-watch-form" onSubmit={submitWatch}>
        <div className="micro">Add a watch without leaving the map</div>
        <div className="rail-form-grid">
          <select value={watchForm.type} onChange={(e) => setWatchForm((f) => ({ ...f, type: e.target.value }))}>
            <option value="region">region</option>
            <option value="entity">entity</option>
            <option value="keyword">keyword</option>
          </select>
          <input
            value={watchForm.value}
            onChange={(e) => setWatchForm((f) => ({ ...f, value: e.target.value }))}
            placeholder={watchForm.type === "region" ? "UA" : "value"}
          />
        </div>
        <div className="rail-form-grid one-two">
          <input value={watchForm.label} onChange={(e) => setWatchForm((f) => ({ ...f, label: e.target.value }))} placeholder="label, optional" />
          <button className="btn" type="submit">Add</button>
        </div>
      </form>

      <div className="rail-tabs" role="tablist" aria-label="Map workbench data">
        {TABS.map((item) => (
          <button key={item.key} aria-selected={tab === item.key} onClick={() => setTab(item.key)}>{item.label}</button>
        ))}
      </div>

      <div className="rail-list">
        {tab === "watching" && (
          watching.length ? watching.slice(0, 6).map((item) => (
            <div key={item._id} className="rail-row">
              <button className="rail-row-main" onClick={() => item.type === "region" && onPickRegion?.(item.value.toUpperCase())}>
                <b>{item.label}</b>
                <span>{item.type} · {item.value}{item.digestSchedule ? " · daily brief" : ""}</span>
              </button>
              <button className="rail-row-x" title="Remove" onClick={() => removeWatch({ id: item._id }).catch(() => setStatus("Could not remove watch."))}>×</button>
            </div>
          )) : <div className="rail-empty">Nothing watched yet. Track a region or add a watch above.</div>
        )}
        {tab === "alerts" && (
          alerts.length ? alerts.slice(0, 6).map((item) => (
            <div key={item._id} className="rail-row">
              <button className="rail-row-main" onClick={() => item.isoA2 && onPickRegion?.(item.isoA2)}>
                <b>{item.name}</b>
                <span>severity {item.severityThreshold}+{item.isoA2 ? ` · ${item.isoA2}` : ""}{item.category ? ` · ${item.category}` : ""}</span>
              </button>
              <button className="rail-row-x" title={item.active ? "Pause" : "Resume"} onClick={() => setAlertActive({ id: item._id, active: !item.active })}>{item.active ? "Ⅱ" : "▶"}</button>
            </div>
          )) : <div className="rail-empty">No alerts yet. Create one for the current scope above.</div>
        )}
        {tab === "briefs" && (
          briefs.length ? briefs.slice(0, 6).map((item) => (
            <div key={item._id} className="rail-row text">
              <b>{item.title}</b>
              <span>{ago(item.createdAt)} · {item.scopeType}{item.scopeValue ? `:${item.scopeValue}` : ""}</span>
              <p>{item.summary}</p>
            </div>
          )) : <div className="rail-empty">No briefs yet. Create one for the global feed or selected region.</div>
        )}
        {tab === "cases" && (
          cases.length ? cases.slice(0, 6).map((item) => (
            <div key={item._id} className="rail-row text">
              <b>{item.title}</b>
              <span>{item.status} · updated {ago(item.updatedAt)}</span>
              {item.description && <p>{item.description}</p>}
            </div>
          )) : <div className="rail-empty">No case files yet. Open a news item, then add it to a case.</div>
        )}
      </div>

      <section className="rail-recent">
        <div className="micro">Latest on map</div>
        {recentEvents.map((event) => (
          <button key={event._id} className="rail-event" onClick={() => onOpenEvent?.(event)}>
            <span className={`sev-pill sev-${event.tier}`}>{event.tier}</span>
            <span>{event.title}</span>
          </button>
        ))}
      </section>
    </aside>
  );
}
