// Country table and event placement. The ingestor does not geocode yet, so most events
// carry no lat/lon: an event is placed by its own coordinates, then its country, then a
// country named in its title, then the country most of its sources report from.
import type { MaprEvent } from '../types';
import data from './countries.json';

export interface Country {
  a2: string;
  name: string;
  continent: string;
  subregion: string;
  /** Label point [lon, lat]. */
  at: [number, number];
}

interface Props {
  a2: string;
  n: string;
  nl: string;
  c: string;
  r: string;
  lx: number;
  ly: number;
}

const raw = data as unknown as { features: Array<{ properties: Props }>; points: Props[] };

/** Country polygons (Natural Earth 1:110m, public domain) with a2/name props, for fills and hover. */
export const countryShapes = data as unknown as { type: 'FeatureCollection'; features: unknown[] };

export const countries = new Map<string, Country>();
for (const p of [...raw.features.map((f) => f.properties), ...raw.points]) {
  countries.set(p.a2, { a2: p.a2, name: p.n, continent: p.c, subregion: p.r, at: [p.lx, p.ly] });
}

/** Names a headline uses for a country, lower case, longest first so "south sudan" wins over "sudan". */
const ALIASES: Record<string, string[]> = {
  US: ['united states', 'U.S.', 'US', 'USA', 'washington'],
  GB: ['united kingdom', 'britain', 'UK', 'U.K.', 'london'],
  RU: ['russia', 'moscow', 'kremlin'],
  UA: ['ukraine', 'kyiv', 'kharkiv', 'odesa'],
  PS: ['palestine', 'gaza', 'west bank', 'rafah'],
  IL: ['israel', 'israeli'],
  CN: ['china', 'beijing', 'chinese'],
  TW: ['taiwan', 'taipei'],
  KR: ['south korea', 'seoul'],
  KP: ['north korea', 'pyongyang'],
  CD: ['dr congo', 'drc', 'democratic republic of the congo', 'goma', 'kinshasa'],
  CG: ['republic of the congo', 'brazzaville'],
  CI: ["côte d'ivoire", 'ivory coast'],
  AE: ['uae', 'united arab emirates', 'dubai', 'abu dhabi'],
  SY: ['syria', 'damascus'],
  IR: ['iran', 'tehran'],
  MM: ['myanmar', 'burma'],
  CZ: ['czech', 'czechia', 'prague'],
  BA: ['bosnia', 'sarajevo'],
  MK: ['north macedonia'],
  XK: ['kosovo', 'pristina'],
  VA: ['vatican'],
  HK: ['hong kong'],
  SS: ['south sudan', 'juba'],
  SD: ['sudan', 'khartoum', 'darfur', 'el fasher'],
  YE: ['yemen', 'houthi', 'houthis', 'sanaa'],
  LB: ['lebanon', 'beirut', 'hezbollah'],
  TR: ['turkey', 'türkiye', 'turkiye', 'ankara', 'istanbul'],
};

let matchers: Array<[RegExp, string]> | null = null;
function titleMatchers(): Array<[RegExp, string]> {
  if (matchers) return matchers;
  const names: Array<[string, string]> = [];
  for (const c of countries.values()) {
    names.push([c.name.toLowerCase(), c.a2]);
  }
  for (const [a2, list] of Object.entries(ALIASES)) for (const n of list) names.push([n, a2]);
  names.sort((a, b) => b[0].length - a[0].length);
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // All-caps aliases (US, UK) match case-sensitively so "us" the pronoun never counts.
  matchers = names
    .filter(([n]) => n.length > 2 || n === n.toUpperCase())
    .map(([n, a2]) => [new RegExp(`(^|[^\\p{L}])${esc(n)}($|[^\\p{L}])`, n === n.toUpperCase() ? 'u' : 'iu'), a2]);
  return matchers;
}

/** The first country a text names, as ISO 3166-1 alpha-2. */
export function countryInText(text: string): string | null {
  return takeCountry(text)?.a2 ?? null;
}

/** The first country a text names, and the text with that name taken out. */
export function takeCountry(text: string): { a2: string; rest: string } | null {
  for (const [re, a2] of titleMatchers()) {
    const m = re.exec(text);
    if (m) return { a2, rest: `${text.slice(0, m.index)} ${text.slice(m.index + m[0].length)}` };
  }
  return null;
}

export interface Placed {
  /** Exact point when the event has coordinates. */
  point: [number, number] | null;
  country: string | null;
}

const cache = new Map<number, { key: string; placed: Placed }>();

export function place(e: MaprEvent): Placed {
  const key = `${e.updated_at}|${e.lat}|${e.lon}|${e.country}`;
  const hit = cache.get(e.id);
  if (hit && hit.key === key) return hit.placed;
  const placed = locate(e);
  cache.set(e.id, { key, placed });
  return placed;
}

function locate(e: MaprEvent): Placed {
  const point: [number, number] | null = e.lat !== null && e.lon !== null ? [e.lon, e.lat] : null;
  if (e.country) {
    const up = e.country.toUpperCase();
    if (countries.has(up)) return { point, country: up };
    const named = countryInText(e.country);
    if (named) return { point, country: named };
  }
  const named = countryInText(`${e.title} ${e.place ?? ''}`);
  if (named) return { point, country: named };
  const votes = new Map<string, number>();
  for (const s of e.sources) {
    const r = s.region?.toUpperCase();
    if (r && countries.has(r)) votes.set(r, (votes.get(r) ?? 0) + 1);
  }
  let best: string | null = null;
  let n = 0;
  for (const [r, v] of votes) if (v > n) [best, n] = [r, v];
  return { point, country: best };
}

/** Region words a query may use, mapped to a test on a country. */
export const REGIONS: Record<string, (c: Country) => boolean> = {
  europe: (c) => c.continent === 'Europe',
  africa: (c) => c.continent === 'Africa',
  asia: (c) => c.continent === 'Asia',
  oceania: (c) => c.continent === 'Oceania',
  americas: (c) => c.continent === 'North America' || c.continent === 'South America',
  'latin america': (c) => c.subregion === 'South America' || c.subregion === 'Central America' || c.subregion === 'Caribbean',
  'south america': (c) => c.continent === 'South America',
  'north america': (c) => c.subregion === 'Northern America',
  'middle east': (c) => c.subregion === 'Western Asia' || ['EG', 'IR'].includes(c.a2),
  balkans: (c) => ['AL', 'BA', 'BG', 'HR', 'XK', 'ME', 'MK', 'RS', 'SI', 'GR', 'RO'].includes(c.a2),
  sahel: (c) => ['ML', 'BF', 'NE', 'TD', 'MR', 'SD', 'NG', 'SN'].includes(c.a2),
  caribbean: (c) => c.subregion === 'Caribbean',
};
