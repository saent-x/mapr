import type { MaprEvent } from '../src/types';

export const NOW = Date.parse('2026-10-24T12:00:00Z');
export const hoursAgo = (h: number) => new Date(NOW - h * 3_600_000).toISOString();

export function ev(id: number, over: Partial<MaprEvent> = {}): MaprEvent {
  return {
    id,
    title: `Event ${id}`,
    summary: null,
    first_seen: hoursAgo(2),
    last_seen: hoursAgo(1),
    updated_at: hoursAgo(1),
    severity: 2,
    severity_conf: 0.7,
    relevant: true,
    relevance_conf: 0.9,
    category: 'unrest',
    place: 'Kharkiv',
    country: 'UA',
    lat: 50,
    lon: 36.2,
    facts: {},
    source_count: 1,
    article_count: 1,
    triaged_at: hoursAgo(1),
    pinned: false,
    sources: [{ source_id: 1, source: 'Wire', region: 'eu', url: `https://example.com/${id}`, title: 't', published_at: hoursAgo(1), span: 's' }],
    ...over,
  };
}
