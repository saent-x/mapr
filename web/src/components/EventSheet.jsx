import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { anyApi } from "convex/server";
import { CloseIco } from "./icons.jsx";

const ISO2_NAME = {
  JP: "Japan", TR: "Türkiye", US: "United States", UA: "Ukraine", IL: "Israel", DE: "Germany", FR: "France",
  CN: "China", RU: "Russia", IN: "India", BR: "Brazil", ET: "Ethiopia", YE: "Yemen", CD: "DR Congo", AU: "Australia",
};

export default function EventSheet({ event, onClose, isAuthed }) {
  const [status, setStatus] = useState(null);
  const toggleBookmark = useMutation(anyApi.bookmarks.toggle);
  const createCase = useMutation(anyApi.cases.create);
  const addCaseItem = useMutation(anyApi.cases.addItem);
  const createAlert = useMutation(anyApi.alerts.create);
  const cases = useQuery(anyApi.cases.list, isAuthed ? {} : "skip") ?? [];
  if (!event) return null;
  const when = new Date(event.publishedAt).toISOString().replace("T", " ").slice(0, 16) + "Z";
  const save = async () => {
    if (!isAuthed) {
      setStatus("Sign in to save this item to your map library.");
      return;
    }
    setStatus("Saving bookmark...");
    try {
      await toggleBookmark({
        storyId: event.externalId,
        storyTitle: event.title,
        storySummary: event.summary,
        source: event.source,
        url: event.url,
        eventId: event._id,
        region: event.isoA2,
        severity: event.severity,
      });
      setStatus("Saved to bookmarks");
    } catch (err) {
      setStatus("Could not save bookmark");
    }
  };
  const runPaid = async (label, fn) => {
    setStatus(`${label}…`);
    try {
      await fn();
      setStatus(`${label} saved`);
    } catch (err) {
      setStatus(String(err?.message || err).includes("FEATURE") ? "Pro unlock required for this workflow" : "Could not save action");
    }
  };
  const addToCase = async () => {
    const caseId = cases[0]?._id ?? await createCase({ title: `${event.isoA2 || "Global"} watch`, description: "Created from map event." });
    await addCaseItem({
      caseId,
      type: "event",
      eventId: event._id,
      title: event.title,
      summary: event.summary,
      source: event.source,
      url: event.url,
      region: event.isoA2,
      severity: event.severity,
    });
  };
  return (
    <aside className="event-sheet" aria-label="News dossier">
      <div className="event-sheet-head">
        <div>
          <div className="micro">News dossier</div>
          <span className={`sev-pill sev-${event.tier}`}>
            {event.tier.toUpperCase()} · {event.severity.toFixed(1)}
          </span>
        </div>
        <span className="spacer" />
        <button onClick={onClose} title="Close">{CloseIco}</button>
      </div>
      <div className="event-sheet-body">
        <div className="event-title serif">{event.title}</div>
        <div className="event-meta">
          <span>{ISO2_NAME[event.isoA2] || event.isoA2 || "N/A"}</span>
          <span>{event.category}</span>
          <span>{when}</span>
        </div>
        {event.summary && <p className="event-summary">{event.summary}</p>}

        <section className="event-intel-block">
          <div className="micro">Why this is on the map</div>
          <div className="event-facts">
            <span>Severity <b>{event.severity.toFixed(1)}</b></span>
            <span>Region <b>{event.isoA2 || "Global"}</b></span>
            <span>Source <b>{event.source}</b></span>
            <span>Evidence <b>{event.articleCount ?? 1} cited item{(event.articleCount ?? 1) === 1 ? "" : "s"}</b></span>
          </div>
        </section>

        <section className="event-intel-block">
          <div className="micro">Source pack</div>
          <p>This panel is a cited evidence item. Open the original source, save it, or put it into a case file without leaving the map.</p>
          {event.url && (
            <a className="scope-action" href={event.url} target="_blank" rel="noreferrer">
              <span>Open original source</span>
              <small>{event.source}</small>
            </a>
          )}
        </section>

        <section className="event-actions-grid">
          <button className="scope-action" onClick={save}>
            <span>Save to bookmarks</span>
            <small>Keep this source item in your map library.</small>
          </button>
          <button className="scope-action" onClick={() => runPaid("Adding to case", addToCase)}>
            <span>Add to case file</span>
            <small>Use it as evidence in the active analyst case.</small>
          </button>
          <button className="scope-action" onClick={() => runPaid("Creating alert", () => createAlert({ name: `${event.isoA2 || "Global"} ${event.category} alert`, severityThreshold: Math.max(6, Math.floor(event.severity)), isoA2: event.isoA2, category: event.category, channels: ["email"], digestSchedule: { cadence: "daily", hourUTC: 8 } }))}>
            <span>Alert on similar</span>
            <small>Email me when matching red-tier events appear.</small>
          </button>
        </section>

        {!isAuthed && <div className="inline-status">Sign in to save bookmarks, alerts, and case evidence.</div>}
        {status && <div className="inline-status">{status}</div>}
      </div>
    </aside>
  );
}
