import land from 'virtual:world';
import { compareEvents, isFresh } from '../snapshot';
import type { EventsResponse, LiveMessage, MaprEvent } from '../types';

const SEV_NAME = ['', 'LOW', 'ELEVATED', 'HIGH', 'CRITICAL'] as const;
const SVG = 'http://www.w3.org/2000/svg';

const $ = <T extends Element>(id: string) => document.getElementById(id) as unknown as T;
const listEl = $<HTMLElement>('list');
const detailEl = $<HTMLElement>('detail');
const mapEl = $<SVGSVGElement>('map');
const tallyEl = $<HTMLElement>('tally');
const linkEl = $<HTMLElement>('link');
const clockEl = $<HTMLElement>('clock');

const byId = new Map<number, MaprEvent>();
let order: MaprEvent[] = [];
let selected: number | null = null;
const fresh = new Set<number>();

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

const sevClass = (e: MaprEvent) => `sev sev--s${e.severity ?? 0}`;
const sevShort = (e: MaprEvent) => (e.severity ? `S${e.severity}` : 'S–');

function age(iso: string): string {
  const s = Math.max(0, (Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  return `${Math.floor(s / 3600)}h`;
}
const hhmm = (iso: string | null) => (iso ? `${iso.slice(11, 16)}` : '');

function safeUrl(u: string): string | null {
  try {
    const p = new URL(u);
    return p.protocol === 'https:' || p.protocol === 'http:' ? p.href : null;
  } catch {
    return null;
  }
}

/** Link to the quoted span on the source page (text fragment of its opening words). */
function spanUrl(url: string, span: string): string {
  const words = span.trim().split(/\s+/).slice(0, 8).join(' ');
  const enc = (s: string) => encodeURIComponent(s).replace(/-/g, '%2D');
  return `${url.split('#')[0]}#:~:text=${enc(words)}`;
}

function place(e: MaprEvent): string {
  return [e.place, e.country].filter(Boolean).join(', ');
}

/* ---------- state ---------- */

function resort() {
  const now = Date.now();
  for (const [id, e] of byId) if (!isFresh(e, now)) byId.delete(id);
  order = [...byId.values()].sort(compareEvents);
  if (selected === null || !byId.has(selected)) selected = order[0]?.id ?? null;
}

function upsert(events: MaprEvent[], mark: boolean) {
  for (const e of events) {
    if (e.relevant === false) {
      byId.delete(e.id);
      continue;
    }
    byId.set(e.id, e);
    if (mark) fresh.add(e.id);
  }
}

/* ---------- render ---------- */

function renderTally() {
  const n = [0, 0, 0, 0, 0];
  for (const e of order) n[e.severity ?? 0]!++;
  tallyEl.innerHTML = [4, 3, 2, 1].map((s) => `<span class="sev sev--s${s}">S${s} ${n[s]}</span>`).join('');
}

function renderList() {
  listEl.innerHTML = order
    .map(
      (e) => `<div class="row${fresh.has(e.id) ? ' fresh' : ''}" role="option" data-id="${e.id}" aria-selected="${e.id === selected}">
  <span class="${sevClass(e)}">${sevShort(e)}</span>
  <div><div class="row-title">${esc(e.title)}</div><div class="row-meta">${esc([e.place, e.category].filter(Boolean).join(' · '))}</div></div>
  <div class="row-side num"><b>${e.source_count} src</b><span data-age="${esc(e.updated_at)}">${age(e.updated_at)}</span></div>
</div>`,
    )
    .join('');
  fresh.clear();
}

function renderGrid() {
  let d = '';
  for (let x = 0; x <= 360; x += 30) d += `M${x} 0V180`;
  for (let y = 0; y <= 180; y += 30) d += `M0 ${y}H360`;
  mapEl.innerHTML = `<path class="grid" d="${d}"/><path class="land" d="${land}"/><g id="dots"></g>`;
}

const DOT_R = [1.3, 1.4, 1.7, 2.1, 2.6];

function renderDots() {
  const g = mapEl.querySelector('#dots')!;
  const pts = order.filter((e) => e.lat !== null && e.lon !== null);
  // Low severity first so the worst sit on top; the selection ring last.
  pts.sort((a, b) => (a.severity ?? 0) - (b.severity ?? 0));
  let html = '';
  let ring = '';
  for (const e of pts) {
    const cx = (e.lon! + 180).toFixed(2);
    const cy = (90 - e.lat!).toFixed(2);
    const r = DOT_R[e.severity ?? 0];
    html += `<circle class="dot dot-${e.severity ?? 0}" data-id="${e.id}" cx="${cx}" cy="${cy}" r="${r}"><title>${esc(e.title)}</title></circle>`;
    if (e.id === selected) ring = `<circle class="ring" cx="${cx}" cy="${cy}" r="${r! + 1.4}"/>`;
  }
  g.innerHTML = html + ring;
}

function factValue(v: unknown): string {
  if (v && typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function renderDetail() {
  const e = selected === null ? undefined : byId.get(selected);
  if (!e) {
    detailEl.innerHTML = '';
    return;
  }
  const coords = e.lat !== null && e.lon !== null ? `${Math.abs(e.lat).toFixed(1)}${e.lat >= 0 ? 'N' : 'S'} ${Math.abs(e.lon).toFixed(1)}${e.lon >= 0 ? 'E' : 'W'}` : '';
  const facts = Object.entries(e.facts ?? {});
  const sources = e.sources
    .map((s, i) => {
      const url = safeUrl(s.url);
      const href = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<li>
  <a class="src"${href}>[${i + 1}]</a>
  <div class="src-head"><span>${esc(s.source)}</span><span class="num">${esc([s.region, hhmm(s.published_at)].filter(Boolean).join(' · '))}</span></div>
  ${s.title ? `<a class="src-title"${href}>${esc(s.title)}</a>` : ''}
  ${s.span ? (url ? `<a class="span" href="${esc(spanUrl(url, s.span))}" target="_blank" rel="noopener noreferrer">${esc(s.span)}</a>` : `<p class="span">${esc(s.span)}</p>`) : ''}
</li>`;
    })
    .join('');
  detailEl.innerHTML = `<div class="detail-in">
  <div class="detail-head"><span class="${sevClass(e)}">${e.severity ? `S${e.severity} ${SEV_NAME[e.severity]}` : 'S–'}</span>${e.category ? `<span>${esc(e.category)}</span>` : ''}</div>
  <h1>${esc(e.title)}</h1>
  <div class="facts-line">${[place(e), coords, `${hhmm(e.first_seen)}–${hhmm(e.last_seen)} UTC`, `${e.source_count} src · ${e.article_count} art`]
    .filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`)
    .join('')}</div>
  ${e.summary ? `<p class="summary">${esc(e.summary)}</p>` : ''}
  ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(factValue(v))}</dd>`).join('')}</dl>` : ''}
  <ol class="sources">${sources}</ol>
</div>`;
}

function render() {
  resort();
  renderTally();
  renderList();
  renderDots();
  renderDetail();
}

function select(id: number | null, scroll = true) {
  if (id === null || id === selected) return;
  selected = id;
  for (const el of listEl.querySelectorAll('.row[aria-selected="true"]')) el.setAttribute('aria-selected', 'false');
  const row = listEl.querySelector<HTMLElement>(`.row[data-id="${id}"]`);
  row?.setAttribute('aria-selected', 'true');
  if (scroll) row?.scrollIntoView({ block: 'nearest' });
  renderDots();
  renderDetail();
  detailEl.scrollTop = 0;
}

/* ---------- input ---------- */

listEl.addEventListener('click', (ev) => {
  const row = (ev.target as Element).closest<HTMLElement>('.row');
  if (row) select(Number(row.dataset.id), false);
});
mapEl.addEventListener('click', (ev) => {
  const dot = (ev.target as Element).closest<SVGElement>('.dot');
  if (dot) select(Number(dot.dataset.id));
});
document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const t = ev.target as HTMLElement;
  if (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
  const step = ev.key === 'j' ? 1 : ev.key === 'k' ? -1 : 0;
  if (!step || !order.length) return;
  ev.preventDefault();
  const i = order.findIndex((e) => e.id === selected);
  const next = order[Math.min(order.length - 1, Math.max(0, (i < 0 ? 0 : i + step)))];
  select(next?.id ?? null);
});

/* ---------- data ---------- */

async function load() {
  try {
    const res = await fetch('/api/events', { cache: 'no-store' });
    if (!res.ok) return;
    const body = (await res.json()) as EventsResponse;
    upsert(body.events, false);
    render();
  } catch {
    // next reconnect retries
  }
}

let backoff = 1000;
let reconnecting = false;
let pinger: ReturnType<typeof setInterval> | undefined;

function connect() {
  const ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/live`);
  ws.onopen = () => {
    backoff = 1000;
    linkEl.textContent = 'LIVE';
    linkEl.classList.add('on');
    clearInterval(pinger);
    pinger = setInterval(() => ws.readyState === WebSocket.OPEN && ws.send('ping'), 30_000);
    if (reconnecting) void load(); // cover anything missed while disconnected
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
    upsert(msg.upsert, true);
    render();
  };
  ws.onclose = () => {
    clearInterval(pinger);
    reconnecting = true;
    linkEl.textContent = 'OFFLINE';
    linkEl.classList.remove('on');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}

function tick() {
  clockEl.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}

renderGrid();
tick();
setInterval(tick, 1000);
// Ages and the 24h window move on their own.
setInterval(() => {
  const before = byId.size;
  resort();
  if (byId.size !== before) render();
  else for (const el of listEl.querySelectorAll<HTMLElement>('[data-age]')) el.textContent = age(el.dataset.age!);
}, 30_000);
void load().then(connect);
