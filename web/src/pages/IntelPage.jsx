import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import "./intel.css";

const WINDOWS = [
  { h: 6, label: "6h" },
  { h: 24, label: "24h" },
  { h: 72, label: "72h" },
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

function Spark({ baseline, recent, dir }) {
  const color = dir === "up" ? "var(--sev-red)" : dir === "down" ? "var(--sev-green)" : "var(--ink-2)";
  const lo = Math.min(baseline, recent, 0);
  const hi = Math.max(baseline, recent, 1);
  const span = hi - lo || 1;
  const y = (v) => 16 - ((v - lo) / span) * 14 - 1;
  return (
    <svg width="48" height="18" viewBox="0 0 48 18" style={{ flex: "none" }} aria-hidden="true">
      <line x1="2" y1={y(baseline)} x2="46" y2={y(recent)} stroke={color} strokeWidth="1.5" />
      <circle cx="2" cy={y(baseline)} r="1.8" fill="var(--ink-3)" />
      <circle cx="46" cy={y(recent)} r="2.2" fill={color} />
    </svg>
  );
}

export default function IntelPage() {
  const [windowHours, setWindowHours] = useState(24);
  const data = useQuery(anyApi.intel.overview, { windowHours });

  const loading = data === undefined;
  const tc = data?.tierCounts ?? { green: 0, amber: 0, red: 0, black: 0 };
  const redBlack = (tc.red || 0) + (tc.black || 0);
  const regions = data?.regions ?? [];
  const anomalies = data?.anomalies ?? [];
  const topEvents = data?.topEvents ?? [];

  return (
    <div className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="in-head">
          <Link to="/" className="micro">← Map</Link>
          <div className="in-topline">
            <div className="serif in-title">Situation overview</div>
            <div className="in-win" role="group" aria-label="Time window">
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
                <div key={i} className="kpi in-skel" style={{ height: 70 }} />
              ))}
            </div>
            <div className="in-grid">
              <div className="in-skel" style={{ height: 200 }} />
              <div className="in-skel" style={{ height: 200 }} />
            </div>
          </>
        ) : (
          <>
            <div className="kpis">
              <div className="kpi">
                <div className="k">Total events</div>
                <div className="v tnum">{data.total}</div>
              </div>
              <div className="kpi">
                <div className="k">Red + Black</div>
                <div className="v tnum" style={{ color: redBlack ? "var(--sev-red)" : "var(--ink-0)" }}>
                  {redBlack}
                </div>
              </div>
              <div className="kpi">
                <div className="k">Amber</div>
                <div className="v tnum" style={{ color: tc.amber ? "var(--sev-amber)" : "var(--ink-0)" }}>
                  {tc.amber || 0}
                </div>
              </div>
              <div className="kpi">
                <div className="k">Green</div>
                <div className="v tnum" style={{ color: "var(--sev-green)" }}>{tc.green || 0}</div>
              </div>
            </div>

            <div className="in-grid">
              <div>
                <div className="micro in-section-label">Top hotspots</div>
                {regions.length === 0 ? (
                  <div className="in-empty">No regional activity in this window.</div>
                ) : (
                  <div className="in-col">
                    {regions.map((r) => (
                      <Link key={r.iso} to={`/region/${r.iso}`} className="in-row">
                        <span className="in-row-iso">{r.iso}</span>
                        <div className="in-row-main">
                          <div className="in-row-title">{r.name}</div>
                        </div>
                        <span className="in-row-avg" style={{ color: sevColor(r.avg) }}>
                          {(r.avg ?? 0).toFixed(1)}
                        </span>
                        <span className="in-row-count">{r.count}</span>
                      </Link>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <div className="micro in-section-label">Anomalies</div>
                {anomalies.length === 0 ? (
                  <div className="in-empty">No anomalies detected.</div>
                ) : (
                  <div className="in-col">
                    {anomalies.map((a, i) => (
                      <div key={i} className="in-row">
                        <Spark baseline={a.baseline ?? 0} recent={a.recent ?? 0} dir={a.dir} />
                        <div className="in-row-main">
                          <div className="in-row-title">{a.label}</div>
                          <div className="in-row-iso">
                            {a.baseline ?? 0} → {a.recent ?? 0}
                          </div>
                        </div>
                        <span
                          className="in-anom-delta"
                          style={{
                            color: a.dir === "up" ? "var(--sev-red)" : a.dir === "down" ? "var(--sev-green)" : "var(--ink-2)",
                          }}
                        >
                          {a.dir === "up" ? "▲" : a.dir === "down" ? "▼" : "·"} {a.delta}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            <div style={{ marginTop: 28 }}>
              <div className="micro in-section-label">Top events</div>
              {topEvents.length === 0 ? (
                <div className="in-empty">No events in this window.</div>
              ) : (
                <div className="in-events">
                  {topEvents.map((e) => (
                    <Link key={e.id} to={`/event/${e.id}`} className="in-event">
                      <span className={`sev-pill sev-${e.tier}`}>
                        {e.tier.toUpperCase()} · {(e.severity ?? 0).toFixed(1)}
                      </span>
                      <div className="in-event-body">
                        <div className="in-event-title">{e.title}</div>
                        <div className="event-meta">
                          {e.category && <span>{e.category}</span>}
                          {e.isoA2 && <span>{e.isoA2}</span>}
                          <span>{relTime(e.publishedAt)}</span>
                        </div>
                      </div>
                    </Link>
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
