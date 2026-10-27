// Shapes shared by the Worker and the desk page. Mirrors GET /v1/events in v2/server/src/http/server.ts.

export type Severity = 1 | 2 | 3 | 4;

export interface EventSource {
  source_id?: number;
  source: string;
  region: string | null;
  url: string;
  title: string | null;
  published_at: string | null;
  span: string | null;
}

export interface MaprEvent {
  id: number;
  title: string;
  summary: string | null;
  first_seen: string;
  last_seen: string;
  updated_at: string;
  severity: Severity | null;
  severity_conf: number | null;
  relevant: boolean | null;
  relevance_conf: number | null;
  category: string | null;
  place: string | null;
  country: string | null;
  lat: number | null;
  lon: number | null;
  facts: Record<string, unknown> | null;
  source_count: number;
  article_count: number;
  triaged_at: string | null;
  pinned: boolean;
  sources: EventSource[];
}

/** GET /api/events */
export interface EventsResponse {
  written_at: string | null;
  events: MaprEvent[];
}

/** Messages the LiveHub sends on /live. */
export interface LiveMessage {
  type: 'events';
  upsert: MaprEvent[];
  remove: number[];
}

export const WINDOW_MS = 24 * 3_600_000;
