import { describe, expect, it } from 'vitest';
import { countryInText, place } from '../src/client/geo';
import { matches, parseQuery } from '../src/client/query';
import type { MaprEvent } from '../src/types';

const ev = (over: Partial<MaprEvent>): MaprEvent => ({
  id: 1,
  title: '',
  summary: null,
  first_seen: '2026-11-22T00:00:00Z',
  last_seen: '2026-11-22T00:00:00Z',
  updated_at: '2026-11-22T00:00:00Z',
  severity: 2,
  severity_conf: null,
  relevant: true,
  relevance_conf: null,
  category: 'conflict',
  place: null,
  country: null,
  lat: null,
  lon: null,
  facts: null,
  source_count: 1,
  article_count: 1,
  triaged_at: null,
  pinned: false,
  sources: [],
  ...over,
});

describe('geo', () => {
  it('finds countries in headlines, longest name first, never "us" the pronoun', () => {
    expect(countryInText('Clashes in South Sudan border town')).toBe('SS');
    expect(countryInText('Army ambush in Niger kills 12')).toBe('NE');
    expect(countryInText('Nigeria raises fuel price')).toBe('NG');
    expect(countryInText('US warned supplying submarines')).toBe('US');
    expect(countryInText('Tell us what you saw')).toBeNull();
  });

  it('places by title, then by the sources most of them report from', () => {
    expect(place(ev({ id: 10, title: 'Floods hit Malaysia' })).country).toBe('MY');
    const bySources = ev({ id: 11, title: 'Minister resigns', sources: [{ source: 'a', region: 'BR', url: '', title: null, published_at: null, span: null }, { source: 'b', region: 'BR', url: '', title: null, published_at: null, span: null }, { source: 'c', region: 'global', url: '', title: null, published_at: null, span: null }] });
    expect(place(bySources).country).toBe('BR');
  });
});

describe('query', () => {
  const now = Date.parse('2026-11-22T01:00:00Z');

  it('reads categories, countries, regions, severity and hours', () => {
    const q = parseQuery('Armed clashes in Mali, last 6 hours, high');
    expect([...q.categories]).toEqual(['conflict']);
    expect([...q.countries]).toEqual(['ML']);
    expect(q.hours).toBe(6);
    expect(q.minSeverity).toBe(3);
    expect(q.words).toEqual([]);
    expect(parseQuery('protests in the Middle East').region).toBe('middle east');
  });

  it('filters events', () => {
    const q = parseQuery('conflict in Sudan');
    expect(matches(q, ev({ id: 20, title: 'Shelling in Khartoum' }), now)).toBe(true);
    expect(matches(q, ev({ id: 21, title: 'Shelling in Kharkiv' }), now)).toBe(false);
    expect(matches(q, ev({ id: 22, title: 'Election in Sudan', category: 'political' }), now)).toBe(false);
    expect(matches(parseQuery('flood'), ev({ id: 23, title: 'Flood relief centres ready', category: 'weather' }), now)).toBe(true);
    expect(matches(parseQuery('last 1 hour'), ev({ id: 24, last_seen: '2026-11-21T20:00:00Z' }), now)).toBe(false);
  });
});
