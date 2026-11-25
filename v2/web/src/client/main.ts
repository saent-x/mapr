import { isFresh } from '../snapshot';
import type { EventsResponse, LiveMessage, MaprEvent } from '../types';
import { countries, place } from './geo';
import { createFlat } from './flat';
import { createGlobe } from './globe';
import { byCountry, matches, parseQuery, summarize, type Query } from './query';
import { esc, hm, type Box, type Callout, type Flow, type Focus, type Hot, type Layer, type Layers, type LonLat, type MapData, type MapView, type Mark, type Pads } from './shared';
import { countryBox } from './world';

const HOUR = 3_600_000;
const SEV_NAME = ['Unrated', 'Low', 'Elevated', 'High', 'Critical'] as const;
const SEV_CLASS = ['routine', 'routine', 'watch', 'elevated', 'critical'] as const;
const ICON_SEND = '<svg class="m-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M8 13V3M3.5 7.5 8 3l4.5 4.5"/></svg>';
const ICON_STOP = '<svg class="m-icon" viewBox="0 0 16 16" aria-hidden="true"><rect x="5" y="5" width="6" height="6" fill="currentColor" stroke="none"/></svg>';
const ICON_CLOSE = '<svg class="m-icon" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 3.5l9 9M12.5 3.5l-9 9"/></svg>';

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  stage: $('stage'),
  map: $('map'),
  feedBox: $('feed-box'),
  feed: $('feed'),
  feedTime: $('feed-time'),
  answer: $('answer'),
  hud: $('hud'),
  layers: $('layers'),
  panel: $('panel'),
  panelToggle: $<HTMLButtonElement>('panel-toggle'),
  detail: $('detail'),
  fCat: $('f-cat'),
  chart: $('chart'),
  chartTotal: $('chart-total'),
  chartWin: $('chart-win'),
  ask: $<HTMLFormElement>('ask'),
  q: $<HTMLInputElement>('q'),
  send: $<HTMLButtonElement>('send'),
  scope: $('scope'),
  mic: $<HTMLButtonElement>('mic'),
  live: $('live'),
  link: $('link'),
  clock: $('clock'),
  nEvents: $('n-events'),
  nSources: $('n-sources'),
  nToday: $('n-today'),
  menuBtn: $<HTMLButtonElement>('menu-btn'),
  menu: $('menu'),
  acctBtn: $<HTMLButtonElement>('acct-btn'),
  acct: $('acct'),
  themeItem: $('theme-item'),
  themeState: $('theme-state'),
};

/* ---------- state ---------- */

const byId = new Map<number, MaprEvent>();
let all: MaprEvent[] = [];
let base: MaprEvent[] = [];
let shown: MaprEvent[] = [];
let query: Query | null = null;
let ranked: MaprEvent[] = [];
let selected: number | null = null;
const fresh = new Set<number>();
let newestId: number | null = null;
const filters = { cats: new Set<string>(), minSev: 0, hours: 24 };
const layers: Layers = { events: true, density: true, flows: true, night: true, labels: true };
let follow = false;
let panelOpen = true;
let sheetOpen = false;
let busy = false;
let markOf = new Map<number, Mark>();
let data: MapData = { marks: [], flows: [], newest: null, hot: [] };
let focus: Focus | null = null;

const isPhone = () => matchMedia('(max-width: 760px)').matches;
const ts = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
const byRecent = (a: MaprEvent, b: MaprEvent) => ts(b.last_seen) - ts(a.last_seen) || (b.severity ?? 0) - (a.severity ?? 0);
const byWeight = (a: MaprEvent, b: MaprEvent) => (b.severity ?? 0) - (a.severity ?? 0) || b.source_count - a.source_count || ts(b.last_seen) - ts(a.last_seen);
const fmt = (n: number) => n.toLocaleString('en');
const countryName = (a2: string | null) => (a2 ? countries.get(a2)?.name ?? a2 : '');

function placeName(e: MaprEvent): string {
  const c = countryName(place(e).country);
  return [c, e.place && e.place !== c ? e.place : null].filter(Boolean).join(', ') || e.country || 'Unplaced';
}

function coord(c: LonLat): string {
  return `${Math.abs(c[1]).toFixed(2)}°${c[1] < 0 ? 'S' : 'N'} ${Math.abs(c[0]).toFixed(2)}°${c[0] < 0 ? 'W' : 'E'}`;
}

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
  } catch {
    return null;
  }
}

/** Counts per bucket of `size` hours over the last `n` buckets, oldest first. */
function buckets(times: number[], n: number, size: number, now: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const t of times) {
    const back = Math.floor((now - t) / (size * HOUR));
    if (back >= 0 && back < n) out[n - 1 - back]!++;
  }
  return out;
}

/** Change of the last 12 hours against the 12 before, or '' when there is too little to compare. */
function change(events: MaprEvent[], now: number): { text: string; pct: number } {
  const recent = events.filter((e) => ts(e.last_seen) >= now - 12 * HOUR).length;
  const before = events.length - recent;
  if (before < 3) return { text: '', pct: 0 };
  const pct = Math.round(((recent - before) / before) * 100);
  return { text: `${pct >= 0 ? '+' : ''}${pct}%`, pct };
}

function upsert(events: MaprEvent[], mark: boolean) {
  for (const e of events) {
    if (e.relevant === false) {
      byId.delete(e.id);
      continue;
    }
    if (mark && !byId.has(e.id)) {
      fresh.add(e.id);
      newestId = e.id;
    }
    byId.set(e.id, e);
  }
}

function recompute() {
  const now = Date.now();
  for (const [id, e] of byId) if (!isFresh(e, now)) byId.delete(id);
  all = [...byId.values()].sort(byRecent);
  const hours = query?.hours ?? filters.hours;
  base = all.filter(
    (e) =>
      (!filters.cats.size || !filters.cats.has(e.category ?? 'other')) &&
      (e.severity ?? 0) >= filters.minSev &&
      ts(e.last_seen) >= now - hours * HOUR,
  );
  shown = query ? base.filter((e) => matches(query!, e, now)) : base;
  ranked = shown.slice().sort(byWeight);
  if (selected !== null && !byId.has(selected)) selected = null;
  if (newestId === null || !byId.has(newestId)) newestId = all.reduce<MaprEvent | null>((a, e) => (!a || ts(e.first_seen) > ts(a.first_seen) ? e : a), null)?.id ?? null;
}

/* ---------- what the map draws ---------- */

function buildData(): MapData {
  const marks = new Map<string, Mark>();
  markOf = new Map();
  const list = query ? base : shown;
  for (const e of list) {
    const p = place(e);
    const at = p.point ?? (p.country ? countries.get(p.country)?.at : undefined);
    if (!at) continue;
    const key = p.point ? `e${e.id}` : `c${p.country}`;
    let m = marks.get(key);
    if (!m) {
      m = { key, c: [at[0], at[1]], k: 0, n: p.point ? e.place || countryName(p.country) : countryName(p.country), sev: 0, ev: e, events: [], country: p.country };
      marks.set(key, m);
    }
    m.events.push(e);
    m.k += Math.max(1, e.source_count);
    m.sev = Math.max(m.sev, e.severity ?? 0);
    if (byWeight(e, m.ev) < 0) m.ev = e;
    markOf.set(e.id, m);
  }
  const ms = [...marks.values()];

  // reported from: where the sources of the busiest marks write from
  const flows: Flow[] = [];
  for (const m of ms
    .filter((x) => !query || shown.some((e) => markOf.get(e.id) === x))
    .sort((a, b) => b.k - a.k)
    .slice(0, 8)) {
    const seen = new Set<string>();
    for (const e of m.events)
      for (const s of e.sources) {
        const r = s.region?.toUpperCase();
        if (!r || r === m.country || seen.has(r)) continue;
        const at = countries.get(r)?.at;
        if (!at) continue;
        seen.add(r);
        if (seen.size <= 3) flows.push({ a: [at[0], at[1]], b: m.c, key: m.key });
      }
  }

  const now = Date.now();
  const hot: Hot[] = byCountry(shown)
    .slice(0, 3)
    .map((r) => {
      const here = shown.filter((e) => place(e).country === r.a2);
      const ch = change(here, now);
      const at = countries.get(r.a2)!.at;
      return { a2: r.a2, name: r.name, c: [at[0], at[1]] as LonLat, reports: here.reduce((s, e) => s + e.source_count, 0), change: ch.text, up: ch.pct > 20 };
    });

  const nm = newestId !== null ? markOf.get(newestId) : undefined;
  return { marks: ms, flows, newest: nm?.key ?? null, hot };
}

function buildFocus(q: Query): Focus {
  const match = new Set<string>();
  for (const e of shown) {
    const m = markOf.get(e.id);
    if (m) match.add(m.key);
  }
  const callouts: Callout[] = [];
  const used = new Set<string>();
  for (const e of ranked) {
    const m = markOf.get(e.id);
    if (!m || used.has(m.key)) continue;
    used.add(m.key);
    callouts.push({ n: callouts.length, mark: m, ev: e });
    if (callouts.length === (isPhone() ? 2 : 4)) break;
  }
  const rows = byCountry(shown);
  const max = Math.max(1, rows[0]?.count ?? 1);
  const hl = new Map(rows.map((r) => [r.a2, Math.pow(r.count / max, 0.7)]));

  const boxes: Box[] = [];
  if (q.countries.size) for (const a2 of q.countries) {
    const b = countryBox(a2);
    if (b) boxes.push(b);
  }
  if (!boxes.length) {
    const pts = [...match].map((k) => data.marks.find((m) => m.key === k)?.c).filter((c): c is LonLat => !!c);
    if (pts.length) {
      const w = Math.min(...pts.map((p) => p[0]));
      const e = Math.max(...pts.map((p) => p[0]));
      const s = Math.min(...pts.map((p) => p[1]));
      const n = Math.max(...pts.map((p) => p[1]));
      const px = Math.max(3, (e - w) * 0.15);
      const py = Math.max(3, (n - s) * 0.15);
      boxes.push([w - px, s - py, e + px, n + py]);
    }
  }
  const bbox: Box = boxes.length
    ? [Math.min(...boxes.map((b) => b[0])), Math.max(-80, Math.min(...boxes.map((b) => b[1]))), Math.max(...boxes.map((b) => b[2])), Math.min(80, Math.max(...boxes.map((b) => b[3])))]
    : [-125, -40, 150, 66];
  return { match, callouts, hl, bbox, center: [(bbox[0] + bbox[2]) / 2, (bbox[1] + bbox[3]) / 2] };
}

function queryPlace(q: Query): string {
  if (q.countries.size) return [...q.countries].map(countryName).join(', ');
  if (q.region) return q.region.replace(/\b\w/g, (c) => c.toUpperCase());
  return 'World';
}

/* ---------- map view ---------- */

let view: MapView | null = null;
let kind: 'globe' | 'flat' = (() => {
  try {
    return localStorage.getItem('mapr.view') === 'flat' ? 'flat' : 'globe';
  } catch {
    return 'globe';
  }
})();

function pads(): Pads {
  if (isPhone()) return { l: 16, r: 16, t: 52, b: query || selected !== null ? Math.round(el.stage.clientHeight * 0.46) + 8 : 96 };
  return { l: query ? 384 : 290, r: selected !== null ? 410 : panelOpen ? 270 : 260, t: query ? 64 : 24, b: 96 };
}

function makeView(start?: LonLat) {
  view?.destroy();
  const o = { el: el.map, pads: pads(), phone: isPhone(), layers, data, onPick, popHTML, start };
  view = kind === 'globe' ? createGlobe(o) : createFlat(o);
  if (focus) view.query(focus);
  else if (selected !== null) {
    const m = markOf.get(selected);
    if (m) {
      view.setFocus(m.key);
      view.flyTo(m.c);
    }
  }
  for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]')) b.classList.toggle('m-link--off', b.dataset.view !== kind);
}

function onPick(key: string, eventId?: number) {
  if (eventId !== undefined) return select(eventId);
  const m = data.marks.find((x) => x.key === key);
  if (m) select(m.ev.id);
}

function popHTML(a2: string): string | null {
  const name = countryName(a2);
  if (!name) return null;
  const now = Date.now();
  const here = shown.filter((e) => place(e).country === a2).sort(byWeight);
  const last = here.reduce((t, e) => Math.max(t, ts(e.last_seen)), 0);
  const head = `<div class="m-pop__head"><h4>${esc(name)}</h4><span class="m-card__meta">${here.length ? `Last event ${new Date(last).toISOString().slice(11, 16)} UTC` : 'No events · 24h'}</span></div>`;
  if (!here.length) return `<div class="m-pop">${head}</div>`;
  const ch = change(here, now);
  const sources = here.reduce((s, e) => s + e.source_count, 0);
  const hrs = buckets(here.map((e) => ts(e.last_seen)), 24, 1, now);
  const mx = Math.max(1, ...hrs);
  const sx = (i: number) => (i * 248) / 23;
  const sy = (v: number) => 38 - (v / mx) * 34;
  const spark = hrs.map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`).join(' ');
  return `<div class="m-pop">${head}<div class="m-pop__stats"><div><b>${here.length}</b><span>events</span></div><div><b${ch.pct > 20 ? ' style="color:var(--critical)"' : ''}>${esc(ch.text || '–')}</b><span>vs prior 12h</span></div><div><b>${sources}</b><span>sources</span></div></div>
<div class="m-chart" style="padding:12px 12px 0"><svg viewBox="0 0 248 40"><line class="grid" x1="0" x2="248" y1="20" y2="20"/><line class="base" x1="0" x2="248" y1="39.5" y2="39.5"/><polyline class="spark" points="${spark}"/><circle class="spark-end" r="2.5" cx="248" cy="${sy(hrs[23]!)}"/></svg></div>
<ul class="m-pop__list">${here
    .slice(0, 3)
    .map((e) => `<li>${esc(e.place || e.title.slice(0, 40))}<span>${e.source_count} · ${hm(e.last_seen)}</span></li>`)
    .join('')}</ul></div>`;
}

/* ---------- render ---------- */

function renderStatus() {
  const sources = new Set<string>();
  for (const e of all) for (const s of e.sources) sources.add(s.source);
  el.nEvents.textContent = fmt(all.length);
  el.nSources.textContent = fmt(sources.size);
  el.nToday.textContent = fmt(all.length);
}

function renderFeed() {
  const now = Date.now();
  const rows = shown.slice(0, 60);
  el.feed.innerHTML = rows.length
    ? rows
        .map((e) => {
          const age = now - ts(e.last_seen);
          const a = age < 15 * 60_000 ? 0 : age < HOUR ? 1 : age < 6 * HOUR ? 2 : 3;
          const p = place(e);
          const where = p.point ? coord(p.point) : placeName(e);
          return `<li data-id="${e.id}" data-age="${a}" data-sev="${e.severity ?? 0}" class="${[e.id === selected ? 'is-sel' : '', fresh.has(e.id) ? 'is-new' : ''].join(' ').trim()}" tabindex="0"><strong>${esc(e.title)}</strong><span>${esc(where)} · ${hm(e.last_seen)} UTC</span></li>`;
        })
        .join('')
    : '<li class="d-empty">No events match.</li>';
  fresh.clear();
}

function renderChart() {
  const now = Date.now();
  const hours = Math.min(24, query?.hours ?? filters.hours);
  const counts = buckets(shown.map((e) => ts(e.last_seen)), 24, 1, now);
  const raw = Math.max(1, ...counts);
  const max = raw <= 5 ? 5 : raw <= 10 ? 10 : raw <= 20 ? 20 : raw <= 50 ? 50 : Math.ceil(raw / 100) * 100;
  const W = 288;
  const H = 96;
  const L = 22;
  const T = 6;
  const B = 18;
  const bw = (W - L) / 24;
  const y = (v: number) => T + (H - T - B) * (1 - v / max);
  let h = '';
  for (const v of [0, max / 2, max]) h += `<line class="grid" x1="${L}" x2="${W}" y1="${y(v)}" y2="${y(v)}"/><text x="0" y="${y(v) + 3}">${v}</text>`;
  counts.forEach((v, i) => {
    h += `<rect class="bar${i === 23 ? ' is-now' : ''}" x="${(L + i * bw + 1).toFixed(1)}" y="${y(v).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${(H - B - y(v)).toFixed(1)}"/>`;
  });
  h += `<line class="base" x1="${L}" x2="${W}" y1="${H - B + 0.5}" y2="${H - B + 0.5}"/>`;
  for (const i of [0, 6, 12, 18]) h += `<text x="${L + i * bw + bw / 2}" y="${H - 4}" text-anchor="middle">${new Date(now - (23 - i) * HOUR).toISOString().slice(11, 13)}</text>`;
  h += `<text x="${L + 23 * bw + bw / 2}" y="${H - 4}" text-anchor="middle" style="fill:var(--signal)">now</text>`;
  el.chart.innerHTML = h;
  el.chartTotal.textContent = fmt(shown.length);
  el.chartWin.textContent = `${hours}h`;
}

function renderCats() {
  const counts = new Map<string, number>();
  for (const e of all) counts.set(e.category ?? 'other', (counts.get(e.category ?? 'other') ?? 0) + 1);
  const cats = [...counts].sort((a, b) => b[1] - a[1]).map(([c]) => c);
  const html = cats
    .map((c) => `<button class="m-chip" type="button" data-cat="${esc(c)}" aria-pressed="${!filters.cats.has(c)}">${esc(c[0]!.toUpperCase() + c.slice(1))}</button>`)
    .join('');
  if (el.fCat.innerHTML !== html) el.fCat.innerHTML = html;
}

function renderAnswer() {
  if (!query) {
    el.answer.hidden = true;
    el.hud.hidden = true;
    el.feedBox.hidden = false;
    return;
  }
  const now = Date.now();
  const rows = byCountry(shown).slice(0, 6);
  const max = Math.max(1, rows[0]?.count ?? 1);
  const top = focus?.callouts ?? [];
  const sentences = top
    .slice(0, 3)
    .map((c, i) => `${i === 0 ? ' The most reported is' : i === 1 ? ' In' : ''} <b>${esc(c.mark.n)}</b>${i === 2 ? ':' : i === 0 ? ':' : ','} ${esc(c.ev.title)}<a class="m-ref" href="#" data-fly="${i}">${i + 1}</a>`)
    .join('');
  const summary = summarize(shown, now)
    .map(([t, b]) => (b ? `<b>${esc(t)}</b>` : esc(t)))
    .join('');
  const sources = shown.reduce((s, e) => s + e.source_count, 0);
  const cats = [...query.categories].join(', ') || 'all events';
  const win = query.hours ? `last ${query.hours}h` : `last ${filters.hours}h`;
  el.hud.innerHTML = `<div class="d-hud"><span class="m-live" role="img" aria-label="Live"></span><b>${esc(queryPlace(query))}</b><span>· ${esc(cats)} · ${esc(win)}</span><span class="d-hud__sep"></span><span><b>${fmt(shown.length)}</b> events · <b>${rows.length ? byCountry(shown).length : 0}</b> countries · <b>${fmt(sources)}</b> sources</span></div>`;
  el.hud.hidden = isPhone();
  el.answer.innerHTML = `<div class="m-answer d-answer">
<div class="m-row" style="justify-content:space-between;gap:8px;flex-wrap:nowrap"><div class="m-answer__q">${esc(query.text)}</div><button class="m-link m-link--off" type="button" data-clear style="font-size:12px">Clear</button></div>
<p class="m-answer__a">${summary}${sentences}</p>
${rows.length > 1 ? `<div class="d-bars">${rows.map((r) => `<button type="button" data-country="${esc(r.a2)}"><span>${esc(r.name)}</span><i style="width:${Math.round((r.count / max) * 100)}%"></i><span>${r.count}</span></button>`).join('')}</div>` : ''}
${ranked.length ? `<ol class="d-results">${ranked
    .slice(0, 8)
    .map((e, i) => `<li data-event="${e.id}"><b>${i + 1}</b><span>${esc(e.title)}</span><time>${e.source_count} · ${hm(e.last_seen)}</time></li>`)
    .join('')}</ol>` : ''}
</div>`;
  el.answer.hidden = false;
  el.feedBox.hidden = true;
}

function renderDetail() {
  const e = selected === null ? undefined : byId.get(selected);
  el.detail.hidden = !e;
  el.layers.hidden = !!e;
  document.body.classList.toggle('has-detail', !!e);
  if (!e) {
    el.detail.innerHTML = '';
    return;
  }
  const now = Date.now();
  const sev = e.severity ?? 0;
  const p = place(e);
  const pubs = e.sources.map((s) => ts(s.published_at)).filter(Boolean);
  const hrs = buckets(pubs, 24, 1, now);
  const W = 328;
  const H = 56;
  const bw = W / 24;
  const mx = Math.max(1, ...hrs);
  let bars = '';
  hrs.forEach((v, i) => {
    const bh = ((H - 12) * v) / mx;
    bars += `<rect class="bar${i === 23 ? ' is-now' : ''}" x="${(i * bw + 1).toFixed(1)}" y="${(H - 12 - bh).toFixed(1)}" width="${(bw - 2).toFixed(1)}" height="${bh.toFixed(1)}"/>`;
  });
  bars += `<line class="base" x1="0" x2="${W}" y1="${H - 11.5}" y2="${H - 11.5}"/><text x="0" y="${H}">−24h</text><text x="${W}" y="${H}" text-anchor="end" style="fill:var(--signal)">now</text>`;
  const facts = Object.entries(e.facts ?? {});
  const factValue = (v: unknown) => (v && typeof v === 'object' && 'value' in v ? String((v as { value: unknown }).value) : typeof v === 'object' ? JSON.stringify(v) : String(v));
  const reports = e.sources
    .slice()
    .sort((a, b) => ts(b.published_at) - ts(a.published_at))
    .map((s) => {
      const url = safeUrl(s.url);
      const title = esc(s.title || s.source);
      return `<li><time>${hm(s.published_at)}</time><div><b>${esc([s.source, s.region].filter(Boolean).join(' · '))}</b>${url ? `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${title}</a>` : `<span>${title}</span>`}${s.span ? `<q>${esc(s.span)}</q>` : ''}</div></li>`;
    })
    .join('');
  const country = p.country;
  el.detail.innerHTML = `<article class="m-card d-detail">
<div class="m-card__top"><span class="m-sev m-sev--${SEV_CLASS[sev]}">${SEV_NAME[sev]}</span><span class="m-row" style="gap:12px"><span class="m-card__meta">${hm(e.last_seen)} UTC</span><button class="m-btn m-btn--sm m-btn--icon" style="width:24px" type="button" data-close aria-label="Close">${ICON_CLOSE}</button></span></div>
<div><h4 style="font-size:20px;line-height:26px">${esc(e.title)}</h4><div class="m-card__meta">${esc([placeName(e), p.point ? coord(p.point) : null, e.category].filter(Boolean).join(' · '))}</div></div>
${e.summary ? `<p>${esc(e.summary)}</p>` : ''}
<div class="d-stats"><div><b>${e.source_count}</b><span>sources</span></div><div><b>${e.article_count}</b><span>reports</span></div><div><b>${hm(e.first_seen)}</b><span>first seen</span></div></div>
${facts.length ? `<dl class="d-facts">${facts.map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(factValue(v))}</dd>`).join('')}</dl>` : ''}
${pubs.length ? `<div class="m-chart"><div class="m-chart__head"><h4>Reports per hour</h4></div><svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Reports per hour, last 24 hours">${bars}</svg></div>` : ''}
${reports ? `<ul class="d-reports">${reports}</ul>` : ''}
${country ? `<div class="m-row" style="gap:8px"><button class="m-btn" type="button" data-ask="${esc(countryName(country))}">Ask about ${esc(countryName(country))}</button></div>` : ''}
</article>`;
  el.detail.scrollTop = 0;
}

function renderMap() {
  data = buildData();
  focus = query ? buildFocus(query) : null;
  view?.setData(data);
}

function render() {
  recompute();
  renderStatus();
  renderCats();
  renderMap();
  renderFeed();
  renderChart();
  renderAnswer();
  renderDetail();
}

/* ---------- actions ---------- */

function setBusy(on: boolean) {
  busy = on;
  el.ask.classList.toggle('m-chat--busy', on);
  el.send.innerHTML = on ? ICON_STOP : ICON_SEND;
  el.send.setAttribute('aria-label', on ? 'Stop' : 'Ask');
  el.send.disabled = !on && !el.q.value.trim();
}

function ask(text: string) {
  el.q.value = text;
  const q = parseQuery(text);
  query = q.text ? q : null;
  selected = null;
  sheetOpen = false;
  el.feedBox.classList.remove('is-open');
  render();
  el.scope.hidden = !query;
  el.scope.textContent = query ? `${queryPlace(query)} ·` : '';
  view?.setPads(pads());
  view?.setFocus(null);
  if (query) {
    setBusy(true);
    view?.query(focus, () => setBusy(false));
  } else {
    setBusy(false);
    view?.query(null);
  }
}

function select(id: number | null) {
  selected = id;
  renderFeed();
  renderDetail();
  view?.setPads(pads());
  const m = id === null ? undefined : markOf.get(id);
  view?.setFocus(m?.key ?? null);
  if (m) view?.flyTo(m.c);
  if (isPhone() && id !== null) {
    sheetOpen = false;
    el.feedBox.classList.remove('is-open');
  }
}

/* ---------- input ---------- */

el.ask.addEventListener('submit', (ev) => {
  ev.preventDefault();
  if (busy) {
    setBusy(false);
    return;
  }
  const t = el.q.value.trim();
  if (t) ask(t);
});
el.q.addEventListener('input', () => {
  if (!busy) el.send.disabled = !el.q.value.trim();
});
el.q.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && (el.q.value || query)) {
    ev.preventDefault();
    ask('');
  }
});

el.answer.addEventListener('click', (ev) => {
  const t = ev.target as Element;
  if (t.closest('[data-clear]')) return ask('');
  const fly = t.closest<HTMLElement>('[data-fly]');
  if (fly) {
    ev.preventDefault();
    const c = focus?.callouts[Number(fly.dataset.fly)];
    if (c) select(c.ev.id);
    return;
  }
  const c = t.closest<HTMLElement>('[data-country]')?.dataset.country;
  if (c) return ask(countryName(c));
  const li = t.closest<HTMLElement>('[data-event]');
  if (li) select(Number(li.dataset.event));
});

el.detail.addEventListener('click', (ev) => {
  const t = ev.target as Element;
  if (t.closest('[data-close]')) return select(null);
  const a = t.closest<HTMLElement>('[data-ask]')?.dataset.ask;
  if (a) ask(a);
});

el.feed.addEventListener('click', (ev) => {
  const row = (ev.target as Element).closest<HTMLElement>('[data-id]');
  if (row) select(Number(row.dataset.id));
});
el.feed.addEventListener('keydown', (ev) => {
  const row = (ev.target as Element).closest<HTMLElement>('[data-id]');
  if (row && ev.key === 'Enter') select(Number(row.dataset.id));
});

// layers panel
el.panelToggle.addEventListener('click', () => {
  panelOpen = !panelOpen;
  el.panel.classList.toggle('is-closed', !panelOpen);
  el.panelToggle.textContent = panelOpen ? 'Hide' : 'Show';
  view?.setPads(pads());
});
el.panel.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest<HTMLButtonElement>('.m-chip');
  if (!b) return;
  if (b.dataset.cat) {
    const c = b.dataset.cat;
    if (filters.cats.has(c)) filters.cats.delete(c);
    else filters.cats.add(c);
    return refresh();
  }
  if (b.dataset.layer) {
    const k = b.dataset.layer as Layer;
    layers[k] = !layers[k];
    b.setAttribute('aria-pressed', String(layers[k]));
    view?.setLayer(k, layers[k]);
    return;
  }
  const group = b.parentElement!;
  for (const x of group.querySelectorAll('.m-chip')) x.setAttribute('aria-pressed', String(x === b));
  if (b.dataset.sev !== undefined) filters.minSev = Number(b.dataset.sev);
  if (b.dataset.hours !== undefined) filters.hours = Number(b.dataset.hours);
  if (b.dataset.cam !== undefined) follow = b.dataset.cam === 'follow';
  if (b.dataset.sev !== undefined || b.dataset.hours !== undefined) refresh();
});

/** Filters changed: redraw, and re-aim the question if there is one. */
function refresh() {
  render();
  if (query) view?.query(focus);
}

// views
for (const b of document.querySelectorAll<HTMLButtonElement>('[data-view]'))
  b.addEventListener('click', () => {
    const k = b.dataset.view as 'globe' | 'flat';
    if (k === kind) return;
    const c = view?.center();
    kind = k;
    try {
      localStorage.setItem('mapr.view', k);
    } catch {
      /* private mode */
    }
    makeView(c);
  });

$('zoom-in').addEventListener('click', () => view?.zoomBy(1.25));
$('zoom-out').addEventListener('click', () => view?.zoomBy(0.8));

// phone: the feed opens as a sheet
const toggleSheet = () => {
  sheetOpen = !sheetOpen;
  el.feedBox.classList.toggle('is-open', sheetOpen);
};
$('strip-live').addEventListener('click', toggleSheet);
$('status').addEventListener('click', () => isPhone() && toggleSheet());
el.feedBox.querySelector('[data-close-sheet]')?.addEventListener('click', toggleSheet);

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    closeMenus();
    if (selected !== null) select(null);
  }
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const t = ev.target as HTMLElement;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  if (ev.key === '/') {
    ev.preventDefault();
    el.q.focus();
    return;
  }
  const step = ev.key === 'j' ? 1 : ev.key === 'k' ? -1 : 0;
  if (!step || !shown.length) return;
  ev.preventDefault();
  const i = shown.findIndex((e) => e.id === selected);
  const next = shown[Math.min(shown.length - 1, Math.max(0, i < 0 ? 0 : i + step))];
  select(next?.id ?? null);
});

// menus
const menus: Array<[HTMLButtonElement, HTMLElement]> = [
  [el.menuBtn, el.menu],
  [el.acctBtn, el.acct],
];
function closeMenus(except?: HTMLElement) {
  for (const [b, m] of menus)
    if (m !== except) {
      m.hidden = true;
      b.setAttribute('aria-expanded', 'false');
    }
}
for (const [b, m] of menus)
  b.addEventListener('click', (ev) => {
    ev.stopPropagation();
    closeMenus(m);
    m.hidden = !m.hidden;
    b.setAttribute('aria-expanded', String(!m.hidden));
  });
document.addEventListener('click', (ev) => {
  if (!(ev.target as Element).closest('.d-menu')) closeMenus();
});

// theme: paper by default, night by system setting or choice
function theme(): 'light' | 'dark' {
  const set = document.documentElement.dataset.theme;
  if (set === 'light' || set === 'dark') return set;
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}
function setTheme(t: 'light' | 'dark' | null, rebuild: boolean) {
  if (t) document.documentElement.dataset.theme = t;
  el.themeState.textContent = theme() === 'dark' ? 'On' : 'Off';
  if (rebuild) makeView(view?.center());
}
const toggleTheme = () => {
  const t = theme() === 'dark' ? 'light' : 'dark';
  try {
    localStorage.setItem('mapr.theme', t);
  } catch {
    /* private mode */
  }
  setTheme(t, true);
};
el.themeItem.addEventListener('click', toggleTheme);
el.themeItem.addEventListener('keydown', (e) => e.key === 'Enter' && toggleTheme());
try {
  const saved = localStorage.getItem('mapr.theme');
  setTheme(saved === 'dark' || saved === 'light' ? saved : null, false);
} catch {
  setTheme(null, false);
}
matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!document.documentElement.dataset.theme) makeView(view?.center());
});

// resize: rebuild the view at the new size, keeping where it looks
let resizeT: ReturnType<typeof setTimeout> | undefined;
let lastSize = `${innerWidth}x${innerHeight}`;
addEventListener('resize', () => {
  clearTimeout(resizeT);
  resizeT = setTimeout(() => {
    const size = `${innerWidth}x${innerHeight}`;
    if (size === lastSize) return;
    lastSize = size;
    renderAnswer();
    makeView(view?.center());
  }, 200);
});

/* Dictation, where the browser has it. */
type Recognition = {
  lang: string;
  interimResults: boolean;
  start(): void;
  stop(): void;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
};
const W8 = window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
const Speech = W8.SpeechRecognition ?? W8.webkitSpeechRecognition;
if (Speech) {
  el.mic.hidden = false;
  let rec: Recognition | null = null;
  el.mic.addEventListener('click', () => {
    if (rec) return rec.stop();
    rec = new Speech();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    let final = false;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1]!;
      el.q.value = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(' ');
      final = r.isFinal;
    };
    rec.onend = () => {
      rec = null;
      if (final) ask(el.q.value);
    };
    rec.start();
  });
}

/* ---------- data ---------- */

async function load() {
  try {
    const res = await fetch('/api/events', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as EventsResponse;
    upsert(body.events, false);
    render();
    if (query) view?.query(focus);
  } catch {
    // next reconnect retries
  }
}

let backoff = 1000;
let reconnecting = false;
let pinger: ReturnType<typeof setInterval> | undefined;

function setLink(on: boolean) {
  el.link.textContent = on ? 'Live' : 'Offline';
  $('strip-link').textContent = on ? 'Live' : 'Offline';
  el.live.classList.toggle('m-live--off', !on);
  el.live.setAttribute('aria-label', on ? 'Live' : 'Offline');
}

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
  ws.onopen = () => {
    backoff = 1000;
    setLink(true);
    clearInterval(pinger);
    pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
    if (reconnecting) void load();
  };
  ws.onmessage = (m) => {
    if (typeof m.data !== 'string' || m.data === 'pong') return;
    let msg: LiveMessage;
    try {
      msg = JSON.parse(m.data) as LiveMessage;
    } catch {
      return;
    }
    if (msg.type !== 'events') return;
    for (const id of msg.remove) byId.delete(id);
    const before = newestId;
    upsert(msg.upsert, true);
    render();
    if (follow && !query && selected === null && newestId !== before && newestId !== null) {
      const mk = markOf.get(newestId);
      if (mk) view?.flyTo(mk.c);
    }
  };
  ws.onclose = () => {
    clearInterval(pinger);
    reconnecting = true;
    setLink(false);
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}

function tick() {
  const d = new Date();
  el.clock.textContent = `${d.toISOString().slice(11, 19)} UTC`;
  el.feedTime.textContent = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' })} · ${d.toISOString().slice(11, 19)} UTC`;
}

tick();
setInterval(tick, 1000);
setInterval(() => {
  const before = byId.size;
  recompute();
  if (byId.size !== before) render();
  else renderChart();
}, 60_000);

makeView();
void load().then(connect);

/** For checks in a browser: ask the map from the console or a test. */
(window as unknown as { mapr: unknown }).mapr = { ask };
