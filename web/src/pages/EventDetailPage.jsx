import { useParams, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import "./event.css";

function relTime(ts) {
  if (!ts) return "—";
  const d = Date.now() - ts;
  const m = Math.round(d / 60000);
  if (m < 1) return "now";
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

function isoStamp(ts) {
  if (!ts) return "—";
  try {
    return new Date(ts).toISOString().replace("T", " ").slice(0, 16) + "Z";
  } catch {
    return "—";
  }
}

function SevPill({ tier, severity }) {
  if (!tier) return null;
  return (
    <span className={`sev-pill sev-${tier}`}>
      {tier.toUpperCase()} · {(severity ?? 0).toFixed(1)}
    </span>
  );
}

export default function EventDetailPage() {
  const { id } = useParams();
  const data = useQuery(anyApi.events.detail, { id });

  if (data === undefined) {
    return (
      <div className="page">
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <Link to="/" className="micro">← Map</Link>
          <div className="card" style={{ marginTop: 22 }}>
            <div className="ev-skel" style={{ width: "30%" }} />
            <div className="ev-skel" style={{ height: 28, width: "80%" }} />
            <div className="ev-skel" style={{ width: "50%" }} />
            <div className="ev-skel" style={{ height: 60 }} />
          </div>
        </div>
      </div>
    );
  }

  if (data === null || !data.event) {
    return (
      <div className="page">
        <div style={{ maxWidth: 820, margin: "0 auto" }}>
          <Link to="/" className="micro">← Map</Link>
          <div className="card" style={{ marginTop: 22, textAlign: "center" }}>
            <h2>Event not found</h2>
            <div style={{ color: "var(--ink-2)" }}>
              This event no longer exists or has expired from the feed.
            </div>
            <div>
              <Link to="/" className="btn">Back to map</Link>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const ev = data.event;
  const articles = data.articles ?? [];
  const entities = Array.isArray(ev.entities) ? ev.entities : [];

  return (
    <div className="page">
      <div style={{ maxWidth: 820, margin: "0 auto" }}>
        <Link to="/" className="micro">← Map</Link>

        <div className="card" style={{ marginTop: 22 }}>
          <div className="ev-head">
            <div className="ev-pills">
              <SevPill tier={ev.tier} severity={ev.severity} />
              <span className="micro">{ev.category}</span>
              {ev.status && <span className="micro">· {ev.status}</span>}
            </div>
            <div className="event-title">{ev.title}</div>
            <div className="event-meta">
              {ev.isoA2 && <span>{ev.isoA2}</span>}
              {ev.source && <span>{ev.source}</span>}
              <span>{isoStamp(ev.publishedAt)}</span>
              {ev.articleCount != null && (
                <span>{ev.articleCount} source{ev.articleCount === 1 ? "" : "s"}</span>
              )}
            </div>
          </div>

          {ev.summary && <div className="event-summary">{ev.summary}</div>}

          {entities.length > 0 && (
            <div>
              <div className="micro ev-section-label">Entities</div>
              <div className="ev-chips">
                {entities.map((en, i) => (
                  <span key={i} className="ev-chip">
                    {typeof en === "string" ? en : en?.name ?? en?.value ?? String(en)}
                  </span>
                ))}
              </div>
            </div>
          )}

          <div className="ev-actions">
            {ev.url && (
              <a className="btn primary" href={ev.url} target="_blank" rel="noreferrer">
                Open source ↗
              </a>
            )}
            {ev.isoA2 && (
              <Link className="btn" to={`/region/${ev.isoA2}`}>
                Region →
              </Link>
            )}
          </div>
        </div>

        <div style={{ marginTop: 28 }}>
          <div className="micro ev-section-label">
            Articles{articles.length ? ` · ${articles.length}` : ""}
          </div>
          {articles.length === 0 ? (
            <div className="card" style={{ color: "var(--ink-2)", textAlign: "center" }}>
              No linked articles for this event.
            </div>
          ) : (
            <div className="ev-articles">
              {articles.map((a) => (
                <div key={a.id} className="ev-article">
                  <SevPill tier={a.tier} severity={a.severity} />
                  <div className="ev-article-body">
                    <div className="ev-article-title">{a.title}</div>
                    <div className="event-meta ev-article-meta">
                      {a.source && <span>{a.source}</span>}
                      <span>{relTime(a.publishedAt)}</span>
                      {a.url && (
                        <a href={a.url} target="_blank" rel="noreferrer" style={{ color: "var(--cyan)" }}>
                          open ↗
                        </a>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
