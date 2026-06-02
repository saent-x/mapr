/**
 * Deterministic natural-language intent parser for the composer's "drive the
 * map" path. Ported from the design bundle's assistant.jsx, adapted to operate
 * on real MAPR events. Pure + offline + instant: NO LLM. Free-form questions
 * are routed to the RAG QA action instead (see rag.ts).
 */

import { regionName } from "./regions.ts";

export type Tier = "green" | "amber" | "red" | "black";

export interface EventLike {
  id: string;
  isoA2: string;
  tier: Tier;
  severity: number;
  category: string;
  publishedAt: number;
  title: string;
  summary: string;
  source: string;
}

export const ISO_NAME: Record<string, string> = {
  JPN: "Japan", TUR: "Türkiye", USA: "United States", BEL: "Belgium", SGP: "Singapore",
  FRA: "France", ARG: "Argentina", IND: "India", EGY: "Egypt", UKR: "Ukraine", ISR: "Israel",
  SSD: "South Sudan", CHN: "China", AUS: "Australia", GBR: "United Kingdom", COD: "DR Congo",
  YEM: "Yemen", HKG: "Hong Kong", MEX: "Mexico", DEU: "Germany", ZAF: "South Africa",
  UZB: "Uzbekistan", BRA: "Brazil", RUS: "Russia", KOR: "South Korea", SVN: "Slovenia",
  CHL: "Chile", IRQ: "Iraq", ITA: "Italy", CHE: "Switzerland", ETH: "Ethiopia", BGD: "Bangladesh",
};

// Map alpha-3 (used by our ISO_NAME keys / design data) to/from alpha-2 stored
// on events. Events carry ISO-3166 alpha-2; the lexicon below resolves names to
// alpha-2 directly to avoid a second mapping table.
const NAME_ISO: Record<string, string> = {
  japan: "JP", honshu: "JP", sendai: "JP", tokyo: "JP",
  turkey: "TR", "türkiye": "TR", turkiye: "TR", marmara: "TR",
  usa: "US", "united states": "US", america: "US", american: "US", washington: "US", texas: "US", florida: "US",
  belgium: "BE", brussels: "BE",
  singapore: "SG",
  france: "FR", french: "FR", paris: "FR",
  argentina: "AR", "buenos aires": "AR",
  india: "IN", indian: "IN", delhi: "IN", mumbai: "IN",
  egypt: "EG", egyptian: "EG", cairo: "EG",
  ukraine: "UA", ukrainian: "UA", kyiv: "UA", kharkiv: "UA",
  israel: "IL", israeli: "IL",
  "south sudan": "SS",
  china: "CN", chinese: "CN", beijing: "CN", shanghai: "CN",
  australia: "AU", australian: "AU", sydney: "AU",
  uk: "GB", britain: "GB", british: "GB", "united kingdom": "GB", london: "GB", england: "GB",
  congo: "CD", drc: "CD", "dr congo": "CD",
  yemen: "YE", "red sea": "YE",
  "hong kong": "HK",
  mexico: "MX", "mexico city": "MX",
  germany: "DE", german: "DE", berlin: "DE",
  "south africa": "ZA", "cape town": "ZA",
  uzbekistan: "UZ",
  brazil: "BR", brazilian: "BR", rio: "BR", "são paulo": "BR", "sao paulo": "BR",
  russia: "RU", russian: "RU", moscow: "RU",
  korea: "KR", "south korea": "KR", seoul: "KR",
  slovenia: "SI",
  chile: "CL", santiago: "CL",
  iraq: "IQ", baghdad: "IQ",
  italy: "IT", italian: "IT", rome: "IT",
  switzerland: "CH", swiss: "CH",
  ethiopia: "ET", "addis": "ET",
  bangladesh: "BD", dhaka: "BD",
};

const GROUP_ISO: Record<string, string[]> = {
  europe: ["FR", "BE", "GB", "DE", "IT", "CH", "SI", "UA"],
  "western europe": ["FR", "BE", "GB", "DE", "IT", "CH"],
  "eastern europe": ["UA", "RU"],
  mena: ["IL", "EG", "YE", "IQ"],
  "middle east": ["IL", "IQ", "YE"],
  africa: ["SS", "CD", "ZA", "ET", "EG"],
  "sub-saharan": ["SS", "CD", "ZA", "ET"],
  asia: ["JP", "SG", "IN", "CN", "HK", "KR", "UZ", "BD"],
  "east asia": ["JP", "CN", "HK", "KR"],
  "south asia": ["IN", "BD"],
  "southeast asia": ["SG", "HK"],
  latam: ["AR", "BR", "CL", "MX"],
  "latin america": ["AR", "BR", "CL", "MX"],
  "south america": ["AR", "BR", "CL"],
  "north america": ["US", "MX"],
  americas: ["US", "MX", "AR", "BR", "CL"],
  oceania: ["AU"],
  cis: ["RU", "UZ", "UA"],
};

const CAT_KEYWORDS: Record<string, string[]> = {
  conflict: ["conflict", "war", "military", "frontier", "escalation", "rocket", "drone", "strike on", "artillery", "clash", "clashes", "armed", "offensive", "ceasefire", "troops"],
  cyber: ["cyber", "ransomware", "hack", "hacked", "breach", "intrusion", "malware", "phishing", "apt", "ddos", "data broker", "exploit", "vulnerability", "outage"],
  unrest: ["protest", "protests", "unrest", "demonstration", "riot", "march", "rally", "strike", "walkout", "picket", "civil"],
  seismic: ["earthquake", "quake", "seismic", "tremor", "tsunami", "aftershock", "magnitude"],
  weather: ["weather", "storm", "flood", "flooding", "hurricane", "typhoon", "cyclone", "heatwave", "bushfire", "wildfire", "rainfall", "avalanche", "drought"],
  economic: ["economic", "economy", "market", "markets", "inflation", "currency", "forex", "rate", "repo", "gilts", "stocks", "bond", "yuan", "pound", "won", "franc"],
  health: ["health", "outbreak", "disease", "cholera", "dengue", "virus", "viral", "fever", "epidemic", "pandemic", "hemorrhagic", "measles"],
  maritime: ["maritime", "vessel", "ship", "shipping", "strait", "naval", "navy", "tanker", "port", "harbour", "harbor"],
  tech: ["tech", "launch", "orbital", "rocket launch", "satellite", "space", "cloud"],
};

const CAT_LABEL: Record<string, string> = {
  conflict: "conflict", cyber: "cyber", unrest: "civil unrest", seismic: "seismic",
  weather: "weather", economic: "economic", health: "public-health", maritime: "maritime", tech: "tech",
};

const TIER_WORDS: Record<Tier, string[]> = {
  black: ["black", "catastrophic", "catastrophe"],
  red: ["red", "critical", "severe", "high-severity", "high severity", "high priority", "worst", "serious"],
  amber: ["amber", "moderate", "medium", "elevated"],
  green: ["green", "low", "minor", "routine", "nominal"],
};

const STOP = new Set(
  "the a an of in on at to for and or is are was show me find list any what whats what's are there how many events event give all current right now happening on map me about with from over near around please tell".split(/\s+/),
);

const TIER_RANK: Record<Tier, number> = { black: 4, red: 3, amber: 2, green: 1 };

export type Intent = "filter" | "count" | "brief" | "top" | "anomalies" | "regions";

export interface ParsedQuery {
  tiers: Tier[];
  cats: string[];
  regions: string[];
  minSev: number;
  topN: number | null;
  win: { hrs: number; label: string } | null;
  intent: Intent;
  tokens: string[];
  raw: string;
}

function parseWindow(q: string): { hrs: number; label: string } | null {
  const m = q.match(/(?:last|past|within)\s+(\d+)\s*(min|minute|minutes|h|hr|hour|hours|d|day|days|week|weeks)/);
  if (m) {
    const n = parseInt(m[1], 10);
    const u = m[2];
    if (/min/.test(u)) return { hrs: n / 60, label: `last ${n} min` };
    if (/^h|hr|hour/.test(u)) return { hrs: n, label: `last ${n}h` };
    if (/^d|day/.test(u)) return { hrs: n * 24, label: `last ${n}d` };
    if (/week/.test(u)) return { hrs: n * 168, label: `last ${n}w` };
  }
  if (/last 6 ?h|past 6 ?h|6 hours/.test(q)) return { hrs: 6, label: "last 6h" };
  if (/last hour|past hour|this hour/.test(q)) return { hrs: 1, label: "last 1h" };
  if (/today|last day|past day|24 ?h/.test(q)) return { hrs: 24, label: "last 24h" };
  if (/this week|past week|last week|7 ?d/.test(q)) return { hrs: 168, label: "last 7d" };
  return null;
}

export function parseQuery(text: string): ParsedQuery {
  const q = " " + text.toLowerCase().trim() + " ";
  const tiers: Tier[] = [];
  for (const [t, words] of Object.entries(TIER_WORDS) as [Tier, string[]][]) {
    if (words.some((w) => q.includes(" " + w) || q.includes(w + " "))) tiers.push(t);
  }

  const cats: string[] = [];
  for (const [c, words] of Object.entries(CAT_KEYWORDS)) {
    if (words.some((w) => q.includes(w))) cats.push(c);
  }

  const regions = new Set<string>();
  for (const [g, iso] of Object.entries(GROUP_ISO)) if (q.includes(g)) iso.forEach((i) => regions.add(i));
  for (const [name, iso] of Object.entries(NAME_ISO)) if (q.includes(" " + name) || q.includes(name + " ")) regions.add(iso);

  let minSev = 0;
  const sm =
    q.match(/(?:sev|severity|score)\s*(?:>=|>|above|over|at least)?\s*(\d+(?:\.\d+)?)/) ||
    q.match(/(?:above|over|at least|greater than)\s+(\d+(?:\.\d+)?)/);
  if (sm) minSev = parseFloat(sm[1]);

  let topN: number | null = null;
  const tn = q.match(/top\s+(\d+)/) || q.match(/(\d+)\s+(?:most|worst|highest|biggest)/);
  if (tn) topN = parseInt(tn[1], 10);

  const win = parseWindow(q);

  const intent: Intent =
    /anomal|spik|surg|unusual|trend|spiking/.test(q) ? "anomalies" :
    /watchlist|hotspot|which (regions|countries)|top (regions|countries|hotspots)|where.*(worst|most)/.test(q) ? "regions" :
    /how many|count|number of|tally/.test(q) ? "count" :
    /brief|sitrep|summar|overview|rundown|catch me up|what'?s (going on|happening)|situation/.test(q) ? "brief" :
    /top|worst|most severe|highest|biggest|priorit/.test(q) ? "top" :
    "filter";

  const tokens = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 4 && !STOP.has(w));

  return { tiers, cats, regions: [...regions], minSev, topN, win, intent, tokens, raw: text };
}

export function applyFilters(events: EventLike[], p: ParsedQuery, defaultWindowMs: number, now: number): EventLike[] {
  const winMs = p.win ? p.win.hrs * 3600 * 1000 : defaultWindowMs;
  let evs = events.filter((e) => now - e.publishedAt <= winMs);
  if (p.tiers.length) evs = evs.filter((e) => p.tiers.includes(e.tier));
  if (p.cats.length) evs = evs.filter((e) => p.cats.includes(e.category));
  if (p.regions.length) evs = evs.filter((e) => p.regions.includes(e.isoA2));
  if (p.minSev > 0) evs = evs.filter((e) => e.severity >= p.minSev);
  if (!p.tiers.length && !p.cats.length && !p.regions.length && p.minSev === 0 && p.tokens.length) {
    const kw = evs.filter((e) =>
      p.tokens.some(
        (t) =>
          e.title.toLowerCase().includes(t) ||
          (e.summary || "").toLowerCase().includes(t) ||
          e.category.includes(t),
      ),
    );
    if (kw.length) evs = kw;
  }
  return evs.sort((a, b) => b.severity - a.severity || b.publishedAt - a.publishedAt);
}

export function describeScope(p: ParsedQuery): string {
  const bits: string[] = [];
  if (p.tiers.length) bits.push(p.tiers.join("/") + "-tier");
  if (p.cats.length) bits.push(p.cats.map((c) => CAT_LABEL[c] ?? c).join(" / "));
  else bits.push("events");
  if (p.minSev > 0) bits.push("sev ≥ " + p.minSev);
  let scope = bits.join(" ");
  if (p.regions.length) {
    const names = p.regions.length <= 2 ? p.regions.map(regionName).join(" & ") : `${p.regions.length} regions`;
    scope += " · " + names;
  }
  if (p.win) scope += " · " + p.win.label;
  return scope;
}

function tierBreak(evs: EventLike[]): string {
  const c: Record<Tier, number> = { black: 0, red: 0, amber: 0, green: 0 };
  evs.forEach((e) => c[e.tier]++);
  const parts: string[] = [];
  if (c.black) parts.push(`${c.black} black`);
  if (c.red) parts.push(`${c.red} red`);
  if (c.amber) parts.push(`${c.amber} amber`);
  if (c.green) parts.push(`${c.green} green`);
  return parts.join(" · ");
}

function topRegions(evs: EventLike[], n = 3): string[] {
  const m = new Map<string, number>();
  evs.forEach((e) => m.set(e.isoA2, (m.get(e.isoA2) ?? 0) + 1));
  return [...m.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, n)
    .map(([iso, ct]) => `${regionName(iso)} (${ct})`);
}

export interface RegionAgg {
  iso: string;
  name: string;
  avg: number;
  count: number;
}
export interface AnomalyAgg {
  label: string;
  delta: string;
  dir: "up" | "down";
  recent: number;
  baseline: number;
}

export type Route = "map" | "qa";

export interface InterpretResult {
  reply: string;
  scope: string | null;
  intent: Intent;
  /**
   * "map" => deterministic path drives the map; "qa" => free-form question with
   * no parsed facets, route to the grounded RAG action instead.
   */
  route: Route;
  /** event ids to plot; undefined => leave the map unchanged (context pivot) */
  eventIds?: string[];
  matchCount: number;
  topEventIds: string[];
  regions?: RegionAgg[];
  anomalies?: AnomalyAgg[];
}

/** Top hotspots by mean severity over the recent window. */
export function computeRegions(recent: EventLike[], n = 6): RegionAgg[] {
  const m = new Map<string, { total: number; count: number }>();
  for (const e of recent) {
    if (!e.isoA2) continue;
    const cur = m.get(e.isoA2) ?? { total: 0, count: 0 };
    cur.total += e.severity;
    cur.count += 1;
    m.set(e.isoA2, cur);
  }
  return [...m.entries()]
    .map(([iso, s]) => ({ iso, name: regionName(iso), avg: s.total / s.count, count: s.count }))
    .sort((a, b) => b.avg - a.avg)
    .slice(0, n);
}

/** Category surges: last-window count vs the preceding window of equal length. */
export function computeAnomalies(all: EventLike[], windowMs: number, now: number, n = 6): AnomalyAgg[] {
  const recent = new Map<string, number>();
  const prior = new Map<string, number>();
  for (const e of all) {
    const age = now - e.publishedAt;
    if (age <= windowMs) recent.set(e.category, (recent.get(e.category) ?? 0) + 1);
    else if (age <= 2 * windowMs) prior.set(e.category, (prior.get(e.category) ?? 0) + 1);
  }
  const cats = new Set([...recent.keys(), ...prior.keys()]);
  const out: AnomalyAgg[] = [];
  for (const cat of cats) {
    const r = recent.get(cat) ?? 0;
    const b = prior.get(cat) ?? 0;
    if (r === 0 && b === 0) continue;
    const pct = b === 0 ? (r > 0 ? 100 : 0) : Math.round(((r - b) / b) * 100);
    out.push({
      label: CAT_LABEL[cat] ?? cat,
      delta: (pct >= 0 ? "+" : "") + pct + "%",
      dir: pct >= 0 ? "up" : "down",
      recent: r,
      baseline: b,
    });
  }
  return out.sort((a, b) => Math.abs(parseInt(b.delta)) - Math.abs(parseInt(a.delta))).slice(0, n);
}

function firstClause(title: string): string {
  return title.split(";")[0];
}

/**
 * Interpret a parsed query against the real event set and produce a grounded
 * reply + scope + the events to plot. `windowDefaultMs` is the map's default
 * window (168h). `recent` should be all events within at least 2x the active
 * window (for anomaly baselines).
 */
/** Compute the route + delegate to the core interpreter. */
export function interpret(p: ParsedQuery, recent: EventLike[], windowDefaultMs: number, now: number): InterpretResult {
  const hasFacets = p.tiers.length > 0 || p.cats.length > 0 || p.regions.length > 0 || p.minSev > 0 || p.win !== null;
  const route: Route = p.intent !== "filter" || hasFacets ? "map" : "qa";
  return { ...interpretCore(p, recent, windowDefaultMs, now), route };
}

function interpretCore(p: ParsedQuery, recent: EventLike[], windowDefaultMs: number, now: number): Omit<InterpretResult, "route"> {
  const activeWindowMs = p.win ? p.win.hrs * 3600 * 1000 : windowDefaultMs;
  const winLabel = p.win ? p.win.label : "last 7d";

  if (p.intent === "anomalies") {
    const items = computeAnomalies(recent, activeWindowMs, now);
    if (!items.length) {
      return { reply: "No category is running materially hot against its prior-window baseline right now.", scope: null, intent: "anomalies", matchCount: 0, topEventIds: [] };
    }
    const sharp = items[0];
    return {
      reply: `${items.length} categories are moving against the prior-window baseline. Sharpest: ${sharp.label} at ${sharp.delta} (${sharp.recent} vs ${sharp.baseline}). Tap a signal to pivot the feed.`,
      scope: null,
      intent: "anomalies",
      matchCount: 0,
      topEventIds: [],
      anomalies: items,
    };
  }

  if (p.intent === "regions") {
    const items = computeRegions(recent.filter((e) => now - e.publishedAt <= activeWindowMs));
    if (!items.length) return { reply: "No located events to rank by region in that window.", scope: null, intent: "regions", matchCount: 0, topEventIds: [] };
    const lead = items[0];
    const second = items[1];
    return {
      reply: `Top hotspots by mean severity: ${lead.name} leads at ${lead.avg.toFixed(1)} across ${lead.count} events${second ? `, then ${second.name} (${second.avg.toFixed(1)})` : ""}. Select a region to open its dossier.`,
      scope: null,
      intent: "regions",
      matchCount: 0,
      topEventIds: [],
      regions: items,
    };
  }

  const matched = applyFilters(recent, p, windowDefaultMs, now);
  const scope = describeScope(p);
  const allIds = matched.map((e) => e.id);

  if (p.intent === "count") {
    if (!matched.length) return { reply: `No ${scope} in the feed for that window.`, scope, intent: "count", matchCount: 0, topEventIds: [], eventIds: [] };
    return {
      reply: `${matched.length} ${scope} — ${tierBreak(matched)}. Concentrated in ${topRegions(matched, 3).join(", ")}.`,
      scope,
      intent: "count",
      matchCount: matched.length,
      eventIds: allIds,
      topEventIds: allIds.slice(0, 6),
    };
  }

  if (p.intent === "brief") {
    const top = matched.slice(0, 4);
    if (!matched.length) return { reply: `Nothing matching that scope in the ${winLabel}.`, scope, intent: "brief", matchCount: 0, topEventIds: [], eventIds: [] };
    return {
      reply: `${matched.length} events in the ${winLabel}${p.cats.length || p.regions.length ? ` matching ${scope}` : ""} — ${tierBreak(matched)}. Leading: ${top.map((e, i) => `(${i + 1}) ${firstClause(e.title)}`).join("  ")}.`,
      scope: p.cats.length || p.regions.length || p.tiers.length ? scope : `feed · ${winLabel}`,
      intent: "brief",
      matchCount: matched.length,
      eventIds: allIds,
      topEventIds: top.map((e) => e.id),
    };
  }

  if (p.intent === "top") {
    const n = p.topN ?? 5;
    const top = matched.slice(0, n);
    if (!top.length) return { reply: `No ${scope} to rank in that window.`, scope, intent: "top", matchCount: 0, topEventIds: [], eventIds: [] };
    const lead = top[0];
    return {
      reply: `The ${top.length} highest-severity ${p.cats.length ? (CAT_LABEL[p.cats[0]] ?? p.cats[0]) + " " : ""}events right now, led by ${firstClause(lead.title)} — ${lead.tier.toUpperCase()} · sev ${lead.severity.toFixed(1)} in ${regionName(lead.isoA2)}.`,
      scope: scope + (p.topN ? "" : " · top " + n),
      intent: "top",
      matchCount: top.length,
      eventIds: top.map((e) => e.id),
      topEventIds: top.map((e) => e.id),
    };
  }

  // filter / show (default)
  if (!matched.length) {
    const nearest = [...recent].sort((a, b) => b.severity - a.severity).slice(0, 3);
    return {
      reply: `No events match ${scope}. The most active threads overall are ${nearest.map((e) => firstClause(e.title)).slice(0, 2).join("; ")}.`,
      scope,
      intent: "filter",
      matchCount: 0,
      eventIds: [],
      topEventIds: [],
    };
  }
  const lead = matched[0];
  let reply = `${matched.length} ${scope}. `;
  if (matched.length === 1) {
    reply += `${lead.title} — ${lead.tier.toUpperCase()} · sev ${lead.severity.toFixed(1)}, ${regionName(lead.isoA2)}.`;
  } else {
    reply += `Most severe: ${firstClause(lead.title)} (${lead.tier.toUpperCase()} · ${lead.severity.toFixed(1)}, ${regionName(lead.isoA2)}). Also active in ${topRegions(matched, 3).join(", ")}.`;
  }
  return {
    reply,
    scope,
    intent: "filter",
    matchCount: matched.length,
    eventIds: allIds,
    topEventIds: matched.slice(0, 8).map((e) => e.id),
  };
}

export { TIER_RANK, CAT_LABEL, regionName };
