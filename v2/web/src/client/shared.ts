// What the globe and the flat map both draw, and the bits of overlay they share.
import type { MaprEvent } from '../types';

export type LonLat = [number, number];
export type Box = [number, number, number, number];

/** One "+" on the map: an event with its own coordinates, or a country holding events placed only by country. */
export interface Mark {
  key: string;
  c: LonLat;
  /** Weight: distinct sources, summed over the events in the mark. */
  k: number;
  /** Label: the place name. */
  n: string;
  /** 0–4, the highest in the mark. */
  sev: number;
  /** Lead event: the most severe, then most reported. */
  ev: MaprEvent;
  events: MaprEvent[];
  country: string | null;
}

/** "Reported from": an arc from a source's country to the event. */
export interface Flow {
  a: LonLat;
  b: LonLat;
  key: string;
}

/** A country tag on the globe: the busiest countries in view. */
export interface Hot {
  a2: string;
  name: string;
  c: LonLat;
  reports: number;
  change: string;
  up: boolean;
}

export interface MapData {
  marks: Mark[];
  flows: Flow[];
  newest: string | null;
  hot: Hot[];
}

export interface Callout {
  n: number;
  mark: Mark;
  ev: MaprEvent;
}

/** A question's answer on the map. */
export interface Focus {
  match: Set<string>;
  callouts: Callout[];
  /** Country fill strength by alpha-2, 0–1. */
  hl: Map<string, number>;
  bbox: Box;
  center: LonLat;
}

export interface Pads {
  l: number;
  r: number;
  t: number;
  b: number;
}

export type Layer = 'events' | 'density' | 'flows' | 'night' | 'labels';
export type Layers = Record<Layer, boolean>;

export interface ViewOptions {
  el: HTMLElement;
  pads: Pads;
  phone: boolean;
  layers: Layers;
  data: MapData;
  /** Click on a label, callout or "+". */
  onPick(key: string, eventId?: number): void;
  /** The hover card for a country, or null for none. */
  popHTML(a2: string): string | null;
  /** Where the camera starts: [lon, lat]. */
  start?: LonLat;
}

export interface MapView {
  setData(d: MapData): void;
  setLayer(k: Layer, on: boolean): void;
  setPads(p: Pads): void;
  /** Fly to the answer's area and draw it; null flies home. */
  query(f: Focus | null, done?: () => void): void;
  flyTo(c: LonLat): void;
  setFocus(key: string | null): void;
  zoomBy(f: number): void;
  center(): LonLat;
  destroy(): void;
}

export const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
export const hm = (iso: string | null | undefined) => (iso ? iso.slice(11, 16) : '');
export const isCrit = (sev: number) => sev >= 4;
export const still = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

export function calloutHTML(c: Callout, x: number, y: number): string {
  const e = c.ev;
  const meta = [`${e.source_count} source${e.source_count === 1 ? '' : 's'}`, e.category, `${hm(e.last_seen)} UTC`].filter(Boolean).join(' · ');
  return `<div class="m-callout${isCrit(e.severity ?? 0) ? ' is-crit' : ''}" data-callout="${c.n}" style="left:${x}px;top:${y}px"><b class="m-callout__n">${c.n + 1}</b><div><strong>${esc(c.mark.n)}</strong><span>${esc(meta)}</span><p>${esc(e.title)}</p></div></div>`;
}

export interface Placed<T> {
  it: T;
  x: number;
  y: number;
  ax: number;
  ay: number;
}

/** Put 236×88 cards next to their points without overlap, inside the padded frame. */
export function placeCallouts<T extends { x: number; y: number }>(items: T[], W: number, H: number, pad: Pads): Array<Placed<T>> {
  const CW = 236;
  const CH = 88;
  const boxes: Box[] = [];
  const out: Array<Placed<T>> = [];
  for (const it of items) {
    const cands: Array<[number, number]> = [
      [it.x + 30, it.y - CH - 18],
      [it.x + 30, it.y + 18],
      [it.x - 30 - CW, it.y - CH - 18],
      [it.x - 30 - CW, it.y + 18],
      [it.x + 30, it.y - CH / 2],
      [it.x - 30 - CW, it.y - CH / 2],
      [it.x + 30, it.y + CH + 36],
      [it.x - 30 - CW, it.y + CH + 36],
      [it.x + 30, it.y - 2 * CH - 36],
      [it.x - 30 - CW, it.y - 2 * CH - 36],
    ];
    for (const [x, y] of cands) {
      const b: Box = [x, y, x + CW, y + CH];
      if (b[0] < pad.l || b[2] > W - pad.r || b[1] < pad.t || b[3] > H - pad.b) continue;
      if (boxes.some((o) => !(b[2] + 6 < o[0] || b[0] - 6 > o[2] || b[3] + 6 < o[1] || b[1] - 6 > o[3]))) continue;
      boxes.push(b);
      out.push({ it, x, y, ax: x > it.x ? x : x + CW, ay: Math.max(y + 10, Math.min(y + CH - 10, it.y)) });
      break;
    }
  }
  return out;
}

/** A place label: "+ Name · count", with a box to test collisions. */
export function labelHTML(m: Mark, x: number, y: number, quiet: boolean): string {
  return `<span class="m-label${quiet ? ' m-label--quiet' : ''}" data-key="${esc(m.key)}" style="left:${x}px;top:${y}px"><span class="m-label__bg">${esc(m.n)} <b>· ${m.k}</b></span></span>`;
}
export const labelWidth = (m: Mark) => m.n.length * 7 + 16 + String(m.k).length * 8 + 20;

export const overlaps = (b: Box, list: Box[]) => list.some((o) => !(b[2] < o[0] || b[0] > o[2] || b[3] < o[1] || b[1] > o[3]));
