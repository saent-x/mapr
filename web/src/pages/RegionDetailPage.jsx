import { useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import "./region.css";

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

const TIERS = [
  { key: "green", label: "Green", color: "var(--sev-green)" },
  { key: "amber", label: "Amber", color: "var(--sev-amber)" },
  { key: "red", label: "Red", color: "var(--sev-red)" },
  { key: "black", label: "Black", color: "var(--sev-black)" },
];

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

function sevColor(v) {
  if (v >= 6) return "var(--sev-red)";
  if (v >= 4) return "var(--sev-amber)";
  return "var(--ink-0)";
}

export default function RegionDetailPage() {
  const { iso } = useParams();
  const navigate = useNavigate();
  const [windowHours, setWindowHours] = useState(168);
  const data = useQuery(anyApi.regions.dossier, { iso, windowHours });

  const loading = data === undefined;
  const tc = data?.tierCounts ?? { green: 0, amber: 0, red: 0, black: 0 };
  const tierTotal = TIERS.reduce((s, t) => s + (tc[t.key] || 0), 0);
  const redBlack = (tc.red || 0) + (tc.black || 0);
  const topCat = data?.categories?.[0];
  const events = data?.events ?? [];

  return (
    <div className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="rg-head">
          <Link to="/" className="micro">← Map</Link>
          <div className="rg-topline">
            <div>
              <div className="serif rg-name">{data?.name ?? iso}</div>
              <div className="mono" style={{ color: "var(--ink-2)", marginTop: 4 }}>
                {iso}
              </div>
            </div>
            <div className="rg-win" role="group" aria-label="Time window">
              {WINDOWS.map((w) => (
                <button
                  key={w.h}
                  className={windowHours === w.h ? "on" : ""}
                  onClick={() => setWindowHours(w.h)}
                >
                  {w.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {loading ? (
          <>
            <div className="kpis">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="kpi rg-skel" style={{ height: 70 }} />
              ))}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 22 }}>
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="rg-skel" />
              ))}
            </div>
          </>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="k">Events</div>
                <div className="v tnum">{data.eventCount}</div>
              </div>
              <div className="kpi">
                <div className="k">Avg severity</div>
                <div className="v tnum" style={{ color: sevColor(data.avgSeverity) }}>
                  {(data.avgSeverity ?? 0).toFixed(1)}
                </div>
              </div>
              <div className="kpi">
                <div className="k">Red + Black</div>
                <div className="v tnum" style={{ color: redBlack ? "var(--sev-red)" : "var(--ink-0)" }}>
                  {redBlack}
                </div>
              </div>
              <div className="kpi">
                <div className="k">Top category</div>
                <div className="v" style={{ fontSize: "var(--fs-3)", textTransform: "uppercase", letterSpacing: "0.06em" }}>
                  {topCat ? topCat.key : "—"}
                </div>
              </div>
            </div>

            {tierTotal > 0 && (
              <div style={{ marginTop: 22 }}>
                <div className="micro rg-section-label">Tier breakdown</div>
                <div className="rg-tierbar">
                  {TIERS.map((t) => {
                    const c = tc[t.key] || 0;
                    if (!c) return null;
                    return (
                      <span
                        key={t.key}
                        title={`${t.label}: ${c}`}
                        style={{ width: `${(c / tierTotal) * 100}%`, background: t.color }}
                      />
                    );
                  })}
                </div>
                <div className="rg-tierbar-legend micro">
                  {TIERS.map((t) => (
                    <span key={t.key}>
                      <i style={{ background: t.color }} />
                      {t.label} {tc[t.key] || 0}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {data.categories?.length > 0 && (
              <div style={{ marginTop: 22 }}>
                <div className="micro rg-section-label">Categories</div>
                <div className="rg-chips">
                  {data.categories.map((c) => (
                    <span key={c.key} className="rg-chip">
                      {c.key} <b className="tnum">{c.count}</b>
                    </span>
                  ))}
                </div>
              </div>
            )}

            <div style={{ marginTop: 28 }}>
              <div className="micro rg-section-label">Events</div>
              {events.length === 0 ? (
                <div className="rg-empty">
                  No events for {data.name ?? iso} in this window.
                </div>
              ) : (
                <div className="rg-events">
                  {events.map((e) => (
                    <button
                      key={e.id}
                      className="rg-event"
                      onClick={() => navigate(`/event/${e.id}`)}
                    >
                      <span className={`sev-pill sev-${e.tier}`}>
                        {e.tier.toUpperCase()} · {(e.severity ?? 0).toFixed(1)}
                      </span>
                      <div className="rg-event-body">
                        <div className="rg-event-title">{e.title}</div>
                        <div className="event-meta">
                          <span>{e.category}</span>
                          <span>{e.source}</span>
                          <span>{relTime(e.publishedAt)}</span>
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
