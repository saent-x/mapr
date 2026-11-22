// What a typed query means for the map. Deterministic: no model, so the map reacts
// instantly and the same words always give the same view.
import type { MaprEvent } from '../types';
import { countries, place, REGIONS, takeCountry } from './geo';

export interface Query {
  text: string;
  categories: Set<string>;
  minSeverity: number;
  /** Look-back in hours from now, by last_seen. */
  hours: number | null;
  countries: Set<string>;
  region: string | null;
  words: string[];
}

const CATEGORY_WORDS: Record<string, string[]> = {
  conflict: ['conflict', 'clash', 'clashes', 'fighting', 'attack', 'attacks', 'war', 'strike', 'strikes', 'airstrike', 'airstrikes', 'armed', 'military', 'shelling', 'ambush'],
  unrest: ['unrest', 'protest', 'protests', 'riot', 'riots', 'demonstration', 'demonstrations', 'strike action'],
  political: ['political', 'politics', 'election', 'elections', 'government', 'vote', 'parliament'],
  economic: ['economic', 'economy', 'market', 'markets', 'inflation', 'trade', 'sanctions'],
  cyber: ['cyber', 'hack', 'hacks', 'breach', 'ransomware', 'outage'],
  weather: ['weather', 'storm', 'storms', 'flood', 'floods', 'flooding', 'hurricane', 'typhoon', 'cyclone', 'heatwave', 'wildfire', 'wildfires'],
  health: ['health', 'outbreak', 'disease', 'epidemic', 'virus', 'cholera'],
  maritime: ['maritime', 'shipping', 'ship', 'ships', 'vessel', 'vessels', 'port', 'navy'],
  seismic: ['seismic', 'earthquake', 'earthquakes', 'quake', 'tsunami', 'volcano'],
};

const STOP = new Set(['the', 'a', 'an', 'in', 'on', 'at', 'of', 'for', 'and', 'or', 'to', 'across', 'around', 'near', 'show', 'me', 'what', 'whats', "what's", 'is', 'are', 'happening', 'events', 'event', 'news', 'latest', 'all', 'any', 'with', 'from', 'this', 'week', 'today', 'now', 'last', 'past', 'hours', 'hour', 'only', 'days', 'day']);

export function parseQuery(input: string): Query {
  const text = input.trim();
  let rest = ` ${text.toLowerCase()} `;
  const q: Query = { text, categories: new Set(), minSeverity: 0, hours: null, countries: new Set(), region: null, words: [] };

  const h = rest.match(/(?:last|past)\s+(\d{1,2})\s*(?:h|hours?)\b/) ?? rest.match(/\b(\d{1,2})\s*h\b/);
  if (h) q.hours = Math.min(24, Number(h[1]));
  else if (/\b(last|past)\s+hour\b/.test(rest)) q.hours = 1;

  if (/\b(high|major|serious)\b/.test(rest)) q.minSeverity = 3;
  else if (/\b(critical|severe)\b/.test(rest)) q.minSeverity = 4;

  // Countries: take each one named out of the text, so its name is not also a free word.
  let cased = ` ${text} `; // original case, so "US" and "UK" still match
  for (let hit = takeCountry(cased); hit; hit = takeCountry(cased)) {
    q.countries.add(hit.a2);
    cased = hit.rest;
  }
  rest = ` ${cased.toLowerCase().replace(/[^\p{L}\p{N}'\s-]+/gu, ' ').replace(/\s+/g, ' ').trim()} `;

  for (const name of Object.keys(REGIONS).sort((a, b) => b.length - a.length)) {
    if (rest.includes(` ${name} `)) {
      q.region = name;
      rest = rest.replace(` ${name} `, ' ');
      break;
    }
  }

  for (const raw of rest.split(/[^\p{L}\p{N}'-]+/u)) {
    const w = raw.trim();
    if (!w || STOP.has(w) || /^\d+h?$/.test(w)) continue;
    const cat = Object.keys(CATEGORY_WORDS).find((c) => CATEGORY_WORDS[c]!.includes(w));
    if (cat) q.categories.add(cat);
    else if (!['critical', 'severe', 'high', 'major', 'serious'].includes(w)) q.words.push(w);
  }
  return q;
}

export function matches(q: Query, e: MaprEvent, now: number): boolean {
  if (q.minSeverity && (e.severity ?? 0) < q.minSeverity) return false;
  if (q.categories.size && !(e.category && q.categories.has(e.category))) return false;
  if (q.hours !== null && Date.parse(e.last_seen) < now - q.hours * 3_600_000) return false;
  const c = place(e).country;
  if (q.countries.size && !(c && q.countries.has(c))) return false;
  if (q.region) {
    const test = REGIONS[q.region]!;
    const info = c ? countries.get(c) : undefined;
    if (!info || !test(info)) return false;
  }
  if (q.words.length) {
    const hay = `${e.title} ${e.summary ?? ''} ${e.place ?? ''}`.toLowerCase();
    if (!q.words.every((w) => hay.includes(w))) return false;
  }
  return true;
}

export const isEmpty = (q: Query) => !q.text;

export interface CountryCount {
  a2: string;
  name: string;
  count: number;
  maxSeverity: number;
}

export function byCountry(events: MaprEvent[]): CountryCount[] {
  const m = new Map<string, CountryCount>();
  for (const e of events) {
    const a2 = place(e).country;
    if (!a2) continue;
    const row = m.get(a2) ?? { a2, name: countries.get(a2)?.name ?? a2, count: 0, maxSeverity: 0 };
    row.count++;
    row.maxSeverity = Math.max(row.maxSeverity, e.severity ?? 0);
    m.set(a2, row);
  }
  return [...m.values()].sort((a, b) => b.count - a.count || b.maxSeverity - a.maxSeverity);
}

const listNames = (xs: string[]) => (xs.length < 2 ? xs.join('') : `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}`);

/** One short paragraph about the matches, as [text, bold] runs. */
export function summarize(events: MaprEvent[], now: number): Array<[string, boolean]> {
  if (!events.length) return [['No events match in the last 24 hours.', false]];
  const rows = byCountry(events);
  const high = events.filter((e) => (e.severity ?? 0) >= 3).length;
  const recent = events.filter((e) => Date.parse(e.last_seen) >= now - 6 * 3_600_000).length;
  const out: Array<[string, boolean]> = [[`${events.length.toLocaleString('en')} event${events.length === 1 ? '' : 's'}`, true]];
  out.push([rows.length ? ` in ${rows.length} countr${rows.length === 1 ? 'y' : 'ies'}` : '', false]);
  out.push([recent ? `, ${recent} updated in the last 6 hours.` : '.', false]);
  if (rows.length) {
    out.push([' Most are in ', false], [listNames(rows.slice(0, 3).map((r) => r.name)), true], ['.', false]);
  }
  if (high) out.push([` ${high} rated high or critical.`, false]);
  return out;
}

/** Pills for the next step after a query, or a start when there is none. */
export function suggestions(all: MaprEvent[], q: Query | null, shown: MaprEvent[]): string[] {
  if (q && q.text) {
    const out: string[] = [];
    const top = byCountry(shown)[0];
    if (top && !q.countries.has(top.a2)) out.push(`Only ${top.name}`);
    if (q.minSeverity < 3) out.push('High and critical only');
    if (q.hours === null || q.hours > 6) out.push('Last 6 hours');
    return out.slice(0, 3);
  }
  const pairs = new Map<string, number>();
  for (const e of all) {
    const c = place(e).country;
    if (!c || !e.category || e.category === 'other') continue;
    const k = `${e.category}|${c}`;
    pairs.set(k, (pairs.get(k) ?? 0) + (e.severity ?? 1));
  }
  const used = new Set<string>();
  const out: string[] = [];
  for (const [k] of [...pairs].sort((a, b) => b[1] - a[1])) {
    const [cat, c] = k.split('|') as [string, string];
    if (used.has(c) || used.has(cat)) continue;
    used.add(c).add(cat);
    out.push(`${cat[0]!.toUpperCase()}${cat.slice(1)} in ${countries.get(c)?.name ?? c}`);
    if (out.length === 3) break;
  }
  return out;
}
