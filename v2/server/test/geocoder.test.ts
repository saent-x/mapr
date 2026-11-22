import { describe, expect, it } from 'vitest';
import { HttpGeocoder } from '../src/geo/client.js';

const respond = (status: number, body: unknown): typeof fetch =>
  (async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })) as typeof fetch;

describe('HttpGeocoder', () => {
  it('posts events and cleans results', async () => {
    let sent: unknown;
    const f = (async (_url: string, init: RequestInit) => {
      sent = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({
          results: [
            { place: 'Kharkiv', country: 'UA', lat: 49.98, lon: 36.25, precision: 'city', confidence: 0.9 },
            { place: '', country: 'ukraine', lat: 200, lon: 36, precision: 'planet', confidence: 7 },
          ],
        }),
      );
    }) as unknown as typeof fetch;
    const g = new HttpGeocoder('http://embedder:8788/', 1000, f);
    const out = await g.geocode([
      { texts: [{ text: 'a', weight: 3 }], sourceCountries: ['UA'] },
      { texts: [{ text: 'b', weight: 1 }], sourceCountries: [] },
    ]);
    expect(sent).toEqual({
      events: [
        { texts: [{ text: 'a', weight: 3 }], source_countries: ['UA'] },
        { texts: [{ text: 'b', weight: 1 }], source_countries: [] },
      ],
    });
    expect(out[0]).toEqual({ place: 'Kharkiv', country: 'UA', lat: 49.98, lon: 36.25, precision: 'city', confidence: 0.9 });
    expect(out[1]).toEqual({ place: null, country: null, lat: null, lon: null, precision: null, confidence: 1 });
  });

  it('throws on HTTP errors and count mismatches', async () => {
    await expect(new HttpGeocoder('http://x', 1000, respond(503, { detail: 'geocoder not loaded' })).geocode([{ texts: [], sourceCountries: [] }])).rejects.toThrow('503');
    await expect(new HttpGeocoder('http://x', 1000, respond(200, { results: [] })).geocode([{ texts: [], sourceCountries: [] }])).rejects.toThrow('0 results');
  });
});
