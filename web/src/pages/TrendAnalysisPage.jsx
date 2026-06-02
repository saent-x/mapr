import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { anyApi } from "convex/server";
import "./trends.css";

const WINDOWS = [
  { h: 24, label: "24h" },
  { h: 168, label: "7d" },
  { h: 720, label: "30d" },
];

const TIERS = [
  { key: "green", color: "var(--sev-green)", label: "Green" },
  { key: "amber", color: "var(--sev-amber)", label: "Amber" },
  { key: "red", color: "var(--sev-red)", label: "Red" },
  { key: "black", color: "var(--sev-black)", label: "Black" },
];

function fmtTick(t, bucketMs) {
  const d = new Date(t);
  if (bucketMs < 24 * 3600 * 1000) {
    return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  }
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`;
}

function StackedChart({ buckets, bucketMs }) {
  // Fixed viewBox, scales to container width via width:100%.
  const W = 800;
  const H = 260;
  const padL = 10;
  const padR = 10;
  const padT = 14;
  const padB = 26;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const chartBottom = padT + innerH;
  const n = buckets.length;
  const bandW = innerW / n;
  const barW = Math.max(1, bandW * 0.7);
  const maxTotal = Math.max(1, ...buckets.map((b) => b.total || 0));

  const ticks = useMemo(() => {
    if (n === 0) return [];
    const idxs = n <= 2 ? [...buckets.keys()] : [0, Math.floor(n / 2), n - 1];
    return [...new Set(idxs)].map((i) => ({
      x: padL + (i + 0.5) * bandW,
      label: fmtTick(buckets[i].t, bucketMs),
    }));
  }, [buckets, bucketMs, n, bandW]);

  return (
    <div className="trends-chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Stacked activity over time">
        {/* baseline */}
        <line x1={padL} y1={chartBottom} x2={W - padR} y2={chartBottom} stroke="var(--line-2)" strokeWidth="1" />
        {buckets.map((b, i) => {
          const cx = padL + (i + 0.5) * bandW;
          const x = cx - barW / 2;
          let yCursor = chartBottom;
          return (
            <g key={b.t}>
              {TIERS.map((tier) => {
                const v = b[tier.key] || 0;
                if (v <= 0) return null;
                const h = (v / maxTotal) * innerH;
                yCursor -= h;
                return <rect key={tier.key} x={x} y={yCursor} width={barW} height={h} fill={tier.color} />;
              })}
            </g>
          );
        })}
        <g className="trends-axis">
          {ticks.map((t, i) => (
            <text
              key={i}
              x={t.x}
              y={H - 8}
              textAnchor={i === 0 ? "start" : i === ticks.length - 1 ? "end" : "middle"}
            >
              {t.label}
            </text>
          ))}
        </g>
      </svg>
      <div className="trends-legend">
        {TIERS.map((t) => (
          <span key={t.key} className="lg">
            <span className="sw" style={{ background: t.color }} /> {t.label}
          </span>
        ))}
      </div>
    </div>
  );
}

function BarList({ items, label, render }) {
  const max = Math.max(1, ...items.map((it) => it.count || 0));
  return (
    <div className="card">
      <div className="micro">{label}</div>
      {items.length === 0 ? (
        <p className="event-summary" style={{ color: "var(--ink-2)" }}>None in this window.</p>
      ) : (
        <div className="barlist">
          {items.map((it, i) => (
            <div className="row" key={i}>
              <span className="lbl">{render(it)}</span>
              <span className="cnt tnum">{it.count}</span>
              <span className="track">
                <span className="fill" style={{ width: `${((it.count || 0) / max) * 100}%` }} />
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TrendAnalysisPage() {
  const [windowHours, setWindowHours] = useState(168);
  const data = useQuery(anyApi.trends.series, { windowHours, buckets: 24 });

  const isLoading = data === undefined;
  const buckets = data?.buckets ?? [];
  const hasActivity = (data?.total ?? 0) > 0 && buckets.length > 0;

  return (
    <div className="page">
      <div style={{ maxWidth: 1100, margin: "0 auto" }}>
        <div className="micro">
          <Link to="/">← Map</Link>
        </div>
        <div className="trends-head">
          <h1 className="serif trends-title">Activity trends</h1>
          <div className="win-seg">
            {WINDOWS.map((w) => (
              <button
                key={w.h}
                type="button"
                aria-pressed={windowHours === w.h}
                onClick={() => setWindowHours(w.h)}
              >
                {w.label}
              </button>
            ))}
          </div>
        </div>

        {isLoading ? (
          <div className="card">Loading…</div>
        ) : !hasActivity ? (
          <div className="card">
            <p className="event-summary" style={{ color: "var(--ink-2)" }}>No activity in this window.</p>
          </div>
        ) : (
          <>
            <div className="kpis" style={{ marginBottom: 18 }}>
              <div className="kpi">
                <div className="k">Total events</div>
                <div className="v tnum">{data.total}</div>
              </div>
              <div className="kpi">
                <div className="k">Window</div>
                <div className="v tnum">{Math.round(data.windowHours)}h</div>
              </div>
              <div className="kpi">
                <div className="k">Buckets</div>
                <div className="v tnum">{buckets.length}</div>
              </div>
            </div>

            <div className="card" style={{ marginBottom: 18 }}>
              <StackedChart buckets={buckets} bucketMs={data.bucketMs} />
            </div>

            <div className="trends-cols">
              <BarList
                items={data.topCategories ?? []}
                label="Top categories"
                render={(it) => it.key}
              />
              <BarList
                items={data.topRegions ?? []}
                label="Top regions"
                render={(it) => <Link to={`/region/${it.iso}`}>{it.name || it.iso}</Link>}
              />
            </div>
          </>
        )}
      </div>
    </div>
  );
}
