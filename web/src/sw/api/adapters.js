/* ============================================================
   Adapters — map live Convex rows onto the shapes the Standing Watch
   components were built against (synthetic MAPR shapes). Pure functions,
   no React. This is the seam that lets the editorial UI run on real data.
   ============================================================ */

// Severity tiers carry all meaningful color (matches the backend tier union).
export const TIERS = {
  green: { key: "green", label: "LOW", score: [1, 3.9] },
  amber: { key: "amber", label: "ELEVATED", score: [4, 6.4] },
  red: { key: "red", label: "CRITICAL", score: [6.5, 8.4] },
  black: { key: "black", label: "CATASTROPHIC", score: [8.5, 10] },
};

// Compact ISO-3166 alpha-2 → display name. Falls back to the code itself so an
// unmapped country still renders a sensible chip/label.
const ISO_NAMES = {
  SD: "Sudan", LB: "Lebanon", IL: "Israel", SY: "Syria", UA: "Ukraine", RU: "Russia",
  YE: "Yemen", SA: "Saudi Arabia", AE: "United Arab Emirates", IR: "Iran", IQ: "Iraq",
  KW: "Kuwait", BH: "Bahrain", QA: "Qatar", OM: "Oman", JO: "Jordan", EG: "Egypt",
  NG: "Nigeria", HT: "Haiti", BF: "Burkina Faso", ML: "Mali", NE: "Niger", TD: "Chad",
  PH: "Philippines", AF: "Afghanistan", PK: "Pakistan", IN: "India", BD: "Bangladesh",
  KE: "Kenya", SO: "Somalia", ET: "Ethiopia", ER: "Eritrea", CD: "DR Congo", RW: "Rwanda",
  MZ: "Mozambique", MW: "Malawi", ZA: "South Africa", TW: "Taiwan", CN: "China",
  KP: "North Korea", KR: "South Korea", JP: "Japan", ID: "Indonesia", MM: "Myanmar",
  TH: "Thailand", VN: "Vietnam", SG: "Singapore", US: "United States", MX: "Mexico",
  CO: "Colombia", VE: "Venezuela", BR: "Brazil", AR: "Argentina", PE: "Peru",
  DE: "Germany", FR: "France", GB: "United Kingdom", NL: "Netherlands", FI: "Finland",
  SE: "Sweden", PL: "Poland", TR: "Turkey", GR: "Greece", IT: "Italy", ES: "Spain",
  LY: "Libya", TN: "Tunisia", DZ: "Algeria", MA: "Morocco", GN: "Guinea", SS: "South Sudan",
};
export function regionName(iso2) {
  if (!iso2) return "Unlocated";
  return ISO_NAMES[iso2] || iso2;
}

// ms-epoch → minutes-ago (never negative; clock-skew safe).
export function ageMinFrom(ms) {
  if (!ms) return 0;
  return Math.max(0, Math.round((Date.now() - ms) / 60000));
}

// minutes → compact "23m" / "4h" / "2d" (matches the synthetic MAPR.ago()).
export function ago(min) {
  if (min == null) return "—";
  if (min < 60) return Math.round(min) + "m";
  if (min < 1440) return Math.round(min / 60) + "h";
  return Math.round(min / 1440) + "d";
}

/** Live `events` doc → the event shape the map/cards/chips expect. */
export function adaptEvent(d) {
  if (!d) return null;
  return {
    id: d._id,
    externalId: d.externalId,
    title: d.title,
    snippet: d.summary,
    lng: d.lon,
    lat: d.lat,
    iso2: d.isoA2,
    country: regionName(d.isoA2),
    category: d.category,
    tier: d.tier,
    score: d.severity,
    source: d.source,
    url: d.url ?? null,
    // Events are correlated clusters from the catalog; per-source verification/
    // social flagging is surfaced on the article-level evidence rows.
    verified: true,
    sourceType: "wire",
    ageMin: ageMinFrom(d.publishedAt),
    publishedAt: d.publishedAt,
    entities: d.entities ?? [],
    imageUrl: d.imageUrl ?? null,
    articleCount: d.articleCount ?? 1,
    status: d.status,
  };
}

/** Live `articles` retrieval row (from rag.retrieve) → an evidence row. */
export function adaptEvidence(r, i) {
  if (!r) return null;
  const ageMin = ageMinFrom(r.publishedAt);
  return {
    id: r.articleId || r.eventId || String(i),
    eventId: r.eventId || null,
    title: r.title,
    snippet: r.excerpt || "",
    source: r.source,
    url: r.url ?? null,
    iso2: r.isoA2 || "",
    category: r.category || "",
    tier: r.tier || "amber",
    score: r.severity ?? 5,
    ageMin,
    verified: r.sourceType ? r.sourceType !== "social" : true,
    sourceType: r.sourceType || "wire",
    similarity: r.similarity ?? null,
    imageUrl: r.imageUrl ?? null,
  };
}

/** Build the investigation-card shape from a real rag.ask result + the
 *  deterministic intentSearch facets. "Computed facts, generated prose":
 *  the bottom line + evidence quotes are generated/cited; the facts and
 *  what-changed are deterministic counts over the owned corpus. */
export function buildInvestigation(query, askRes, eventsById, intent, regionIso) {
  const citations = askRes?.citations || [];
  const evidence = citations.map((c, i) => {
    const ev = c.eventId ? eventsById[c.eventId] : null;
    return {
      id: c.articleId || String(i),
      eventId: c.eventId || null,
      title: c.title,
      snippet: c.quote || (ev ? ev.snippet : ""),
      source: c.source,
      url: c.url ?? null,
      iso2: ev?.iso2 || regionIso || "",
      category: ev?.category || "",
      tier: ev?.tier || "amber",
      score: ev?.score ?? 5,
      ageMin: ev?.ageMin ?? null,
      verified: true,
      sourceType: "wire",
      imageUrl: c.imageUrl ?? ev?.imageUrl ?? null,
    };
  });

  // Deterministic computed source-strength over the cited set.
  const n = evidence.length;
  const verified = evidence.filter((e) => e.verified).length;
  const social = evidence.filter((e) => e.sourceType === "social").length;
  const level = n >= 5 ? "HIGH" : n >= 3 ? "MODERATE" : "LIMITED";
  const strength = { level, sources: n, verified, social, note: "Owned corpus · reproducible" };

  // Deterministic computed facts from intentSearch facets.
  const facts = [];
  const f = intent?.facets;
  if (f && f.total != null) {
    const t = f.tiers || {};
    facts.push({ label: "Events in scope", value: String(f.total), sub: regionName(regionIso) });
    facts.push({
      label: "Severity mix",
      value: `${t.black || 0} black · ${t.red || 0} red · ${t.amber || 0} amber`,
      sub: `${t.green || 0} low`,
    });
    if (Array.isArray(f.regions) && f.regions.length) {
      facts.push({
        label: "Top regions",
        value: f.regions.slice(0, 3).map((r) => r.iso).join(" · "),
        sub: `${f.regions[0].count} events`,
      });
    }
  }

  // Deterministic "what changed" from the top anomaly, if present.
  let whatChanged = null;
  const a = Array.isArray(intent?.anomalies) ? intent.anomalies[0] : null;
  if (a) {
    const pct = a.deltaPct ?? a.delta ?? null;
    const scope = a.label || a.scope || a.iso || a.category || "";
    whatChanged = pct != null
      ? `${scope}${scope ? " " : ""}${pct > 0 ? "+" : ""}${Math.round(pct)}% vs prior window`
      : (a.label || a.text || null);
  }

  return {
    query,
    bottomLine: askRes?.answer || "",
    answerMarkdown: askRes?.answer || "",
    strength,
    facts: facts.length ? facts : null,
    evidence,
    whatChanged,
    scope: { region: regionName(regionIso) },
    regionIso: regionIso || null,
    corroboration: null,
    reply: intent?.reply || null,
  };
}

const TIER_RANK = { black: 0, red: 1, amber: 2, green: 3 };
function worstTierFromSplit(t) {
  if (!t) return "amber";
  if (t.black > 0) return "black";
  if (t.red > 0) return "red";
  if (t.amber > 0) return "amber";
  return "green";
}

/** Real computed signals: trends.anomalies (movers) + watchBaselines.listSignals
 *  (the user's fired watches). The "push" side — deterministic, corpus-owned. */
export function buildSignals(anomalies, fired) {
  const sigs = [];
  for (const a of anomalies || []) {
    sigs.push({
      id: "anom:" + a.category + ":" + a.label,
      kind: "anomaly",
      scope: a.label,
      category: a.category,
      iso2: null,
      tier: worstTierFromSplit(a.tiers),
      text: `${a.label} ${a.delta} vs prior window`,
      detail: `${a.recent} events recent · ${a.baseline} prior · ${a.state}`,
      min: a.lastTriggeredAt ? ageMinFrom(a.lastTriggeredAt) : 0,
    });
  }
  for (const s of fired || []) {
    const p = s.payload || {};
    const sample = p.sample || [];
    const tier = sample.length
      ? sample.reduce((w, e) => (TIER_RANK[e.tier] < TIER_RANK[w] ? e.tier : w), "green")
      : "amber";
    sigs.push({
      id: "fire:" + s._id,
      kind: "watch",
      scope: p.label,
      iso2: sample[0]?.isoA2 || null,
      tier,
      text: `${p.label} — ${p.newCount} new since baseline`,
      detail: `${p.escalatedCount || 0} escalated · ${p.resolvedCount || 0} resolved`,
      min: ageMinFrom(s.createdAt),
      watchlistItemId: s.watchlistItemId,
    });
  }
  return sigs.sort((a, b) => a.min - b.min);
}

export function tierForScore(s) {
  return s >= 8.5 ? "black" : s >= 6.5 ? "red" : s >= 4 ? "amber" : "green";
}

/** Real entities.graph → ranked entity rows for the Entities drawer. */
export function buildEntities(graph) {
  if (!graph || !Array.isArray(graph.nodes)) return [];
  const edges = graph.edges || [];
  return graph.nodes.map((n) => {
    const co = edges
      .filter((e) => e.source === n.id || e.target === n.id)
      .map((e) => (e.source === n.id ? e.target : e.source));
    return { name: n.id, mentions: n.count, tier: tierForScore(n.severity || 0), cooccur: co.slice(0, 3), regions: [], type: "ENTITY" };
  });
}

/** Real entities.dossier → the DossierCard shape (facts · co-occurrence graph ·
 *  recent linked reports), all computed over the owned corpus. */
export function buildDossier(d, name) {
  if (!d) return null;
  const entity = d.entity || name;
  const related = d.related || [];
  const top = related.slice(0, 6);
  const graph = {
    canonical: entity,
    mentions: d.eventCount,
    nodes: [
      { id: entity, label: entity, weight: Math.max(1, d.eventCount), self: true },
      ...top.map((r) => ({ id: r.name, label: r.name, weight: r.count })),
    ],
    edges: top.map((r) => [entity, r.name, r.count]),
  };
  const evidence = (d.events || []).slice(0, 3).map((e) => ({
    id: e.id, eventId: e.id, title: e.title, snippet: e.summary,
    source: `${e.articleCount || 1} source${(e.articleCount || 1) === 1 ? "" : "s"}`,
    url: null, iso2: e.isoA2, category: e.category, tier: e.tier, score: e.severity,
    ageMin: ageMinFrom(e.publishedAt), verified: true, sourceType: "wire",
  }));
  return {
    name: entity,
    tier: tierForScore(d.maxSeverity || 0),
    mentions: d.eventCount,
    regions: (d.regions || []).map((r) => r.iso),
    cooccur: related.map((r) => r.name),
    graph,
    evidence,
  };
}

/** Real source catalog → Feeds drawer rows. */
export function buildFeeds(sources) {
  if (!Array.isArray(sources)) return [];
  return sources.map((s) => ({
    id: s.id,
    name: s.name,
    type: (s.kind || "rss").toUpperCase(),
    sourceType: s.sourceType || "other",
    itemCount: s.itemCount || 0,
    health: s.consecutiveFailures === 0 ? "ok" : "lagging",
    note: s.consecutiveFailures > 0 ? `${s.consecutiveFailures} recent failures` : null,
    owned: s.sourceType === "user",
  }));
}

/** Real watchlist items → Watches drawer rows. */
export function buildWatches(items) {
  if (!Array.isArray(items)) return [];
  return items.map((w) => ({
    id: w._id,
    name: w.label,
    type: w.type,
    value: w.value,
    scope: `${(w.type || "").toUpperCase()} · ${w.value}`,
    addedMin: ageMinFrom(w.addedAt),
    matchCount: w.matchCount ?? 0,
    lastMatchMin: w.lastMatchAt ? ageMinFrom(w.lastMatchAt) : null,
  }));
}

/** Real computeWatchDiff → the ChangeReport (Baseline Diff) card shape. */
export function buildDiff(diff, name) {
  if (!diff) return null;
  return {
    name: name || "watch",
    baselineCount: diff.baselineEventCount ?? 0,
    nowCount: diff.currentEventCount ?? 0,
    newCount: (diff.newEvents || []).length,
    escalated: (diff.escalatedEvents || []).length,
    resolved: (diff.resolvedEvents || []).length,
    baselineMin: diff.baselineAt ? ageMinFrom(diff.baselineAt) : 0,
    severityDelta: diff.severityDelta ?? 0,
  };
}

/** Real cases.list → Cases drawer rows. */
export function buildCases(cases) {
  if (!Array.isArray(cases)) return [];
  return cases.map((c) => ({
    id: c._id,
    title: c.title,
    description: c.description || "",
    status: c.status,
    updatedMin: ageMinFrom(c.updatedAt),
    tier: "red",
  }));
}

/** Real cases.get ({case, items}) → the CaseCard shape (frozen evidence + audit). */
export function buildCaseDetail(data) {
  if (!data || !data.case) return null;
  const c = data.case;
  const items = data.items || [];
  const evidence = items
    .filter((i) => i.type === "event" || i.type === "article")
    .slice(0, 6)
    .map((it) => ({
      id: it._id, eventId: it.eventId || null, title: it.title, snippet: it.summary || "",
      source: it.source || "pinned", url: it.url || null, iso2: it.region || "", category: "",
      tier: tierForScore(it.severity ?? 5), score: it.severity ?? 5, ageMin: ageMinFrom(it.createdAt),
      verified: true, sourceType: "wire",
    }));
  const audit = items
    .map((it) => ({ who: "You", action: `pinned ${it.type}: ${(it.title || it.note || it.type).slice(0, 40)}`, min: ageMinFrom(it.createdAt) }))
    .sort((a, b) => b.min - a.min);
  return {
    title: c.title,
    note: c.description || "Resumable investigation — pinned evidence with a forensic audit trail.",
    evidence,
    audit,
  };
}

/** Real trends.series → per-severity-tier sparkline rows with computed deltas
 *  (first-half vs second-half of the window). Deterministic, reproducible. */
export function buildTrends(series) {
  if (!series || !Array.isArray(series.buckets)) return null;
  const tiers = [["black", "CATASTROPHIC"], ["red", "CRITICAL"], ["amber", "ELEVATED"], ["green", "LOW"]];
  const rows = tiers.map(([key, label]) => {
    const values = series.buckets.map((b) => b[key] || 0);
    const half = Math.floor(values.length / 2) || 1;
    const a = values.slice(0, half).reduce((x, y) => x + y, 0);
    const b = values.slice(half).reduce((x, y) => x + y, 0);
    const delta = a > 0 ? Math.round(((b - a) / a) * 100) : b > 0 ? 100 : 0;
    return { cat: label, color: key, values, delta, sum: values.reduce((x, y) => x + y, 0) };
  }).filter((r) => r.sum > 0);
  const days = Math.max(1, Math.round((series.windowHours || 168) / 24));
  const topCats = (series.topCategories || []).slice(0, 2).map((c) => c.key);
  const bottomLine = `${series.total ?? 0} located events over the last ${days}d`
    + (topCats.length ? `, led by ${topCats.join(" and ")}.` : ".");
  return { rows, bottomLine, total: series.total ?? 0, days };
}

/** Centroid of the live events in a region (drives map fly-to). */
export function focusForIso(iso2, events) {
  if (!iso2 || !events || !events.length) return null;
  const evs = events.filter((e) => e.iso2 === iso2);
  if (!evs.length) return null;
  const lng = evs.reduce((a, e) => a + e.lng, 0) / evs.length;
  const lat = evs.reduce((a, e) => a + e.lat, 0) / evs.length;
  return { iso2, lng, lat };
}
