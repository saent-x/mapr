import { Link } from "react-router-dom";
import { NewsImage } from "./CitationTray.jsx";
import { ago, isSocial, regionName } from "./chatUtils.js";

const TIER_VARS = [["black", "--sev-black"], ["red", "--sev-red"], ["amber", "--sev-amber"], ["green", "--sev-green"]];

export function EvidenceEventRow({ event, onOpen }) {
  const when = new Date(event.publishedAt).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

  return (
    <details className="chat-evidence-row">
      <summary className="chat-evidence-row__summary">
        <span className={`sev-pill sev-${event.tier}`}>{event.tier.toUpperCase()}-{event.severity.toFixed(1)}</span>
        <span className="chat-evidence-row__body">
          <span className="chat-evidence-row__title">{event.title}</span>
          <span className="chat-evidence-row__meta">
            {event.category.toUpperCase()} / {regionName(event.isoA2)} / {ago(event.publishedAt)} ago / {event.source}
            {isSocial(event.source) && <span className="social-badge">social</span>}
          </span>
        </span>
        <span className="chat-evidence-row__caret" aria-hidden>v</span>
      </summary>
      <div className="chat-evidence-row__detail">
        <NewsImage src={event.imageUrl} className="chat-evidence-row__image" />
        {event.summary && <p>{event.summary}</p>}
        <dl className="chat-facts">
          <dt>Status</dt><dd>{event.status}</dd>
          <dt>Region</dt><dd>{regionName(event.isoA2)}</dd>
          <dt>Sources</dt><dd>{event.articleCount}</dd>
          <dt>Published</dt><dd>{when}</dd>
        </dl>
        {event.entities?.length > 0 && (
          <div className="chat-tags">
            {event.entities.slice(0, 8).map((tag) => <span key={tag}>{tag}</span>)}
          </div>
        )}
        <div className="chat-actions">
          <Link className="chat-action chat-action--primary" to={`/event/${event._id}`}>View page</Link>
          <button type="button" className="chat-action" onClick={(ev) => { ev.preventDefault(); onOpen(event); }}>Quick view</button>
          {event.url && <a className="chat-action" href={event.url} target="_blank" rel="noreferrer">Source</a>}
        </div>
      </div>
    </details>
  );
}

function Sparkline({ baseline, recent }) {
  const max = Math.max(1, baseline, recent);
  const h = 18;
  const y = (value) => h - (value / max) * (h - 2) - 1;
  const up = recent >= baseline;
  return (
    <svg width="42" height={h} aria-hidden>
      <polyline
        points={`2,${y(baseline)} 40,${y(recent)}`}
        fill="none"
        stroke={up ? "var(--sev-red)" : "var(--sev-green)"}
        strokeWidth="1.5"
      />
    </svg>
  );
}

export function AnomalyRows({ items }) {
  return (
    <div className="chat-info-rows">
      {items.map((item, index) => (
        <div key={`${item.label}-${index}`} className="chat-signal-row">
          <Sparkline baseline={item.baseline} recent={item.recent} />
          <span className="chat-signal-row__label">{item.label}</span>
          <span className={`chat-signal-row__delta ${item.dir === "down" ? "neg" : ""}`}>{item.delta}</span>
        </div>
      ))}
    </div>
  );
}

export function RegionRows({ items, onPick }) {
  return (
    <div className="chat-info-rows">
      {items.map((region) => (
        <button key={region.iso} type="button" className="chat-region-row" onClick={() => onPick?.(region.iso)}>
          <span className="chat-region-row__code">{region.iso}</span>
          <span className="chat-region-row__name">{region.name}</span>
          <span
            className="chat-region-row__avg"
            style={{ color: region.avg >= 6 ? "var(--sev-red)" : region.avg >= 4 ? "var(--sev-amber)" : "var(--sev-green)" }}
          >
            {region.avg.toFixed(1)}
          </span>
          <span className="chat-region-row__count">{region.count} evt</span>
        </button>
      ))}
    </div>
  );
}

export function FacetSummary({ facets }) {
  if (!facets?.total) return null;
  const { total, tiers, regions } = facets;
  const segs = TIER_VARS.filter(([tier]) => (tiers[tier] || 0) > 0);
  const maxRegion = regions?.[0]?.count || 1;

  return (
    <div className="chat-facet">
      <div className="chat-facet__head"><span>Severity mix</span><span>{total} events</span></div>
      <div className="chat-facet__bar" role="img" aria-label="severity distribution">
        {segs.map(([tier, cssVar]) => (
          <span key={tier} style={{ flexGrow: tiers[tier], background: `var(${cssVar})` }} title={`${tier}: ${tiers[tier]}`} />
        ))}
      </div>
      <div className="chat-facet__legend">
        {segs.map(([tier, cssVar]) => (
          <span key={tier}><i style={{ background: `var(${cssVar})` }} />{tier} {tiers[tier]}</span>
        ))}
      </div>
      {regions?.length > 0 && (
        <div className="chat-facet__regions">
          {regions.map((region) => (
            <div key={region.iso} className="chat-facet-region">
              <span>{regionName(region.iso)}</span>
              <i><b style={{ width: `${(region.count / maxRegion) * 100}%` }} /></i>
              <em>{region.count}</em>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
