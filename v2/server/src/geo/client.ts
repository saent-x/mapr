// Client for the embedder's POST /geocode (multilingual NER + GeoNames gazetteer, runs on the server at $0).

export interface GeoText {
  text: string;
  weight: number;
}

export interface GeoInput {
  texts: GeoText[];
  /** ISO 3166-1 alpha-2 of the outlets that reported it; a tie-breaker and the last resort. */
  sourceCountries: string[];
}

export interface GeoResult {
  place: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  precision: 'city' | 'admin1' | 'region' | 'water' | 'country' | 'source' | null;
  confidence: number;
}

export interface Geocoder {
  geocode(events: GeoInput[], signal?: AbortSignal): Promise<GeoResult[]>;
}

export class HttpGeocoder implements Geocoder {
  private readonly endpoint: string;
  constructor(
    url: string,
    private readonly timeoutMs = 60_000,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {
    this.endpoint = url.replace(/\/+$/, '') + '/geocode';
  }

  async geocode(events: GeoInput[], signal?: AbortSignal): Promise<GeoResult[]> {
    const t = AbortSignal.timeout(this.timeoutMs);
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ events: events.map((e) => ({ texts: e.texts, source_countries: e.sourceCountries })) }),
      signal: signal ? AbortSignal.any([signal, t]) : t,
    });
    if (!res.ok) throw new Error(`geocoder HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
    const body = (await res.json()) as { results?: GeoResult[] };
    if (!Array.isArray(body.results) || body.results.length !== events.length) {
      throw new Error(`geocoder returned ${body.results?.length ?? 'no'} results for ${events.length} events`);
    }
    return body.results.map(clean);
  }
}

const PRECISIONS = new Set(['city', 'admin1', 'region', 'water', 'country', 'source']);

function clean(r: GeoResult): GeoResult {
  const lat = Number.isFinite(r.lat) && Math.abs(r.lat!) <= 90 ? r.lat : null;
  const lon = Number.isFinite(r.lon) && Math.abs(r.lon!) <= 180 ? r.lon : null;
  const hasPoint = lat !== null && lon !== null;
  return {
    place: typeof r.place === 'string' && r.place ? r.place.slice(0, 200) : null,
    country: typeof r.country === 'string' && /^[A-Z]{2}$/.test(r.country) ? r.country : null,
    lat: hasPoint ? lat : null,
    lon: hasPoint ? lon : null,
    precision: r.precision && PRECISIONS.has(r.precision) ? r.precision : null,
    confidence: Number.isFinite(r.confidence) ? Math.min(1, Math.max(0, r.confidence)) : 0,
  };
}
