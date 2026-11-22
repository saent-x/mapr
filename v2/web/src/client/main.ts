import { isFresh } from '../snapshot';
import type { EventsResponse, LiveMessage, MaprEvent } from '../types';
import { countries, place } from './geo';
import { createMap, storedProjection, type Mark, type Projection } from './map';
import { byCountry, matches, parseQuery, suggestions, summarize, type Query } from './query';

const SEV_NAME = ['Unrated', 'Low', 'Elevated', 'High', 'Critical'] as const;
const HOUR = 3_600_000;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const el = {
  map: $('map'),
  feed: $('feed'),
  rate: $('rate'),
  panel: $('panel'),
  hover: $('hover'),
  pills: $('pills'),
  ask: $<HTMLFormElement>('ask'),
  q: $<HTMLInputElement>('q'),
  mic: $<HTMLButtonElement>('mic'),
  link: $('link'),
  clock: $('clock'),
  nEvents: $('n-events'),
  nSources: $('n-sources'),
  nCountries: $('n-countries'),
  bars: $('bars'),
  axis: $('axis'),
  total: $('chart-total'),
  delta: $('chart-delta'),
  menuBtn: $<HTMLButtonElement>('menu-btn'),
  menu: $('menu'),
  acctBtn: $<HTMLButtonElement>('acct-btn'),
  acct: $('acct'),
};

const byId = new Map<number, MaprEvent>();
let all: MaprEvent[] = [];
let shown: MaprEvent[] = [];
let query: Query | null = null;
let selected: number | null = null;
const fresh = new Set<number>();

const deskMap = createMap(el.map, {
  onEvent: (id) => select(id),
  onCountry: (a2) => ask(countries.get(a2)?.name ?? a2),
  onHover: (a2, x, y) => hoverCountry(a2, x, y),
});

/* ---------- helpers ---------- */

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const hhmm = (iso: string | null) => (iso ? iso.slice(11, 16) : '');
const ts = (iso: string | null) => (iso ? Date.parse(iso) || 0 : 0);
const byRecent = (a: MaprEvent, b: MaprEvent) => ts(b.last_seen) - ts(a.last_seen) || (b.severity ?? 0) - (a.severity ?? 0);
const fmt = (n: number) => n.toLocaleString('en');

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

function where(e: MaprEvent): string {
  const c = place(e).country;
  return [e.place, c ? countries.get(c)?.name ?? c : e.country].filter(Boolean).join(', ');
}

/** Counts per bucket of `size` hours over the last `n` buckets, oldest first, by last_seen. */
function buckets(events: MaprEvent[], n: number, size: number, now: number): number[] {
  const out = new Array<number>(n).fill(0);
  for (const e of events) {
    const back = Math.floor((now - ts(e.last_seen)) / (size * HOUR));
    if (back >= 0 && back < n) out[n - 1 - back]!++;
  }
  return out;
}

function delta(events: MaprEvent[], now: number): string {
  const recent = events.filter((e) => ts(e.last_seen) >= now - 12 * HOUR).length;
  const before = events.length - recent;
  if (before < 5) return ''; // too few to compare
  const pct = Math.round(((recent - before) / before) * 100);
  return `${pct >= 0 ? '+' : ''}${pct}%`;
}

/* ---------- state ---------- */

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

function recompute() {
  const now = Date.now();
  for (const [id, e] of byId) if (!isFresh(e, now)) byId.delete(id);
  all = [...byId.values()].sort(byRecent);
  shown = query ? all.filter((e) => matches(query!, e, now)) : all;
  if (selected !== null && !byId.has(selected)) selected = null;
}

/* ---------- render ---------- */

function renderStatus() {
  const sources = new Set<string>();
  const located = new Set<string>();
  for (const e of all) {
    for (const s of e.sources) sources.add(s.source);
    const c = place(e).country;
    if (c) located.add(c);
  }
  el.nEvents.textContent = fmt(all.length);
  el.nSources.textContent = fmt(sources.size);
  el.nCountries.textContent = fmt(located.size);
}

function renderFeed() {
  const now = Date.now();
  const lastHour = shown.filter((e) => ts(e.last_seen) >= now - HOUR).length;
  el.rate.textContent = lastHour ? `+${lastHour}/h` : '';
  const rows = shown.slice(0, 80);
  el.feed.innerHTML = rows.length
    ? rows
        .map(
          (e) => `<div class="row${fresh.has(e.id) ? ' fresh' : ''}" role="option" data-id="${e.id}" aria-selected="${e.id === selected}">
  <time class="num">${hhmm(e.last_seen)}</time>
  <div><div class="row-title">${esc(e.title)}</div><div class="row-meta">${esc([where(e), e.category].filter(Boolean).join(' · '))}</div></div>
  <span class="dot" style="opacity:${[0.35, 0.45, 0.65, 0.85, 1][e.severity ?? 0]}"></span>
</div>`,
        )
        .join('')
    : '<div class="empty">No events match.</div>';
  fresh.clear();
}

function renderChart() {
  const now = Date.now();
  const counts = buckets(shown, 24, 1, now);
  const max = Math.max(1, ...counts);
  el.bars.innerHTML = counts.map((n) => `<i style="height:${Math.round((n / max) * 100)}%" title="${n}"></i>`).join('');
  el.total.textContent = fmt(shown.length);
  el.delta.textContent = delta(shown, now);
  const hourAt = (back: number) => new Date(now - back * HOUR).toISOString().slice(11, 13) + ':00';
  el.axis.innerHTML = [23, 17, 11, 5].map((b) => `<span>${hourAt(b)}</span>`).join('') + '<span>Now</span>';
}

function marks(): { marks: Mark[]; tint: Map<string, number> } {
  const out: Mark[] = [];
  const perCountry = new Map<string, { count: number; sev: number }>();
  for (const e of shown) {
    const p = place(e);
    if (p.point) {
      out.push({ key: `e${e.id}`, at: p.point, sev: e.severity ?? 0, count: 1, eventId: e.id, country: p.country });
    } else if (p.country) {
      const row = perCountry.get(p.country) ?? { count: 0, sev: 0 };
      row.count++;
      row.sev = Math.max(row.sev, e.severity ?? 0);
      perCountry.set(p.country, row);
    }
  }
  for (const [a2, r] of perCountry) {
    const c = countries.get(a2);
    if (c) out.push({ key: `c${a2}`, at: c.at, sev: r.sev, count: r.count, eventId: null, country: a2 });
  }
  const rows = byCountry(shown);
  const max = Math.max(1, rows[0]?.count ?? 1);
  const tint = new Map<string, number>();
  for (const r of rows) tint.set(r.a2, Math.pow(r.count / max, 0.7));
  return { marks: out, tint };
}

function renderMap() {
  const m = marks();
  deskMap.setMarks(m.marks);
  deskMap.setTint(m.tint);
  deskMap.setSelected(selectedKey());
}

function selectedKey(): string | null {
  const e = selected === null ? undefined : byId.get(selected);
  if (!e) return null;
  const p = place(e);
  return p.point ? `e${e.id}` : p.country ? `c${p.country}` : null;
}

function renderPills() {
  const list = suggestions(all, query, shown);
  el.pills.innerHTML = list.map((s) => `<button type="button">${esc(s)}</button>`).join('');
}

function renderAnswer(): string {
  if (!query) return '';
  const now = Date.now();
  const rows = byCountry(shown).slice(0, 6);
  const max = Math.max(1, rows[0]?.count ?? 1);
  const cats = new Map<string, number>();
  for (const e of shown) if (e.category) cats.set(e.category, (cats.get(e.category) ?? 0) + 1);
  const topCats = [...cats].sort((a, b) => b[1] - a[1]).slice(0, 4);
  return `<div class="panel-in">
  <div class="panel-top"><span>${esc(query.text)}</span><button class="x" type="button" data-act="clear" aria-label="Clear"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button></div>
  <p class="answer">${summarize(shown, now)
    .map(([t, b]) => (b ? `<b>${esc(t)}</b>` : esc(t)))
    .join('')}</p>
  ${topCats.length ? `<div class="cats">${topCats.map(([c, n]) => `<span><b>${n}</b> ${esc(c)}</span>`).join('')}</div>` : ''}
  ${
    rows.length
      ? `<div class="rank">${rows
          .map(
            (r) =>
              `<button type="button" data-country="${esc(r.a2)}"><span class="rank-name">${esc(r.name)}</span><span class="rank-bar"><i style="width:${Math.round((r.count / max) * 100)}%"></i></span><span class="rank-n">${r.count}</span></button>`,
          )
          .join('')}</div>`
      : ''
  }
</div>`;
}

function factValue(v: unknown): string {
  if (v && typeof v === 'object' && 'value' in v) return String((v as { value: unknown }).value);
  return typeof v === 'object' ? JSON.stringify(v) : String(v);
}

function renderEvent(e: MaprEvent): string {
  const facts = Object.entries(e.facts ?? {});
  const sources = e.sources
    .map((s) => {
      const url = safeUrl(s.url);
      const href = url ? ` href="${esc(url)}" target="_blank" rel="noopener noreferrer"` : '';
      return `<li>
  <div class="src-head"><span>${esc(s.source)}</span><span>${esc([s.region, hhmm(s.published_at)].filter(Boolean).join(' · '))}</span></div>
  ${s.title ? `<a class="src-title"${href}>${esc(s.title)}</a>` : ''}
  ${s.span ? (url ? `<a class="span" href="${esc(spanUrl(url, s.span))}" target="_blank" rel="noopener noreferrer">${esc(s.span)}</a>` : `<p class="span">${esc(s.span)}</p>`) : ''}
</li>`;
    })
    .join('');
  return `<div class="panel-in">
  <div class="panel-top"><span class="sevtag"><i style="opacity:${[0.35, 0.45, 0.65, 0.85, 1][e.severity ?? 0]}"></i>${SEV_NAME[e.severity ?? 0]}${e.category ? ` · ${esc(e.category)}` : ''}</span><button class="x" type="button" data-act="close" aria-label="Close"><svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg></button></div>
  <h1 class="ev-title">${esc(e.title)}</h1>
  <div class="ev-line">${[where(e), `${hhmm(e.first_seen)}–${hhmm(e.last_seen)} UTC`, `${e.source_count} sources · ${e.article_count} articles`]
    .filter(Boolean)
    .map((x) => `<span>${esc(x)}</span>`)
    .join('')}</div>
  ${e.summary ? `<p class="ev-summary">${esc(e.summary)}</p>` : ''}
  ${facts.length ? `<dl class="facts">${facts.map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(factValue(v))}</dd>`).join('')}</dl>` : ''}
  ${sources ? `<ol class="sources">${sources}</ol>` : ''}
</div>`;
}

function renderPanel() {
  const e = selected === null ? undefined : byId.get(selected);
  const html = e ? renderEvent(e) : renderAnswer();
  el.panel.hidden = !html;
  el.panel.innerHTML = html;
}

function render() {
  recompute();
  renderStatus();
  renderFeed();
  renderChart();
  renderMap();
  renderPills();
  renderPanel();
}

/* ---------- actions ---------- */

function fitToShown() {
  const pts: Array<[number, number]> = [];
  for (const e of shown) {
    const p = place(e);
    const at = p.point ?? (p.country ? countries.get(p.country)?.at : undefined);
    if (at) pts.push(at);
  }
  if (pts.length) deskMap.fit(pts);
}

function ask(text: string) {
  el.q.value = text;
  const q = parseQuery(text);
  query = q.text ? q : null;
  selected = null;
  render();
  if (query) fitToShown();
  else deskMap.home();
}

function select(id: number | null, scroll = true) {
  selected = id;
  for (const r of el.feed.querySelectorAll('.row[aria-selected="true"]')) r.setAttribute('aria-selected', 'false');
  const row = id === null ? null : el.feed.querySelector<HTMLElement>(`.row[data-id="${id}"]`);
  row?.setAttribute('aria-selected', 'true');
  if (scroll) row?.scrollIntoView({ block: 'nearest' });
  deskMap.setSelected(selectedKey());
  renderPanel();
  el.panel.scrollTop = 0;
  const e = id === null ? undefined : byId.get(id);
  if (e) {
    const p = place(e);
    const at = p.point ?? (p.country ? countries.get(p.country)?.at : undefined);
    if (at) deskMap.fit([at]);
  }
}

function hoverCountry(a2: string | null, x: number, y: number) {
  deskMap.setHover(a2);
  const c = a2 ? countries.get(a2) : undefined;
  if (!a2 || !c) {
    el.hover.hidden = true;
    return;
  }
  const now = Date.now();
  const here = shown.filter((e) => place(e).country === a2);
  const bars = buckets(here, 6, 4, now);
  const max = Math.max(1, ...bars);
  const d = delta(here, now);
  el.hover.innerHTML = `<div class="hc-head"><span class="hc-name">${esc(c.name)}</span><span class="num accent">${esc(d)}</span></div>
<div class="hc-body"><span class="hc-n">${here.length}<small>events</small></span><span class="hc-bars">${bars.map((n) => `<i style="height:${Math.round((n / max) * 100)}%"></i>`).join('')}</span></div>
${here.length ? `<div class="hc-list">${here
    .slice(0, 3)
    .map((e) => `<div><span class="dot" style="opacity:${[0.35, 0.45, 0.65, 0.85, 1][e.severity ?? 0]}"></span><span>${esc(e.title)}</span></div>`)
    .join('')}</div>` : ''}`;
  el.hover.hidden = false;
  const box = el.map.getBoundingClientRect();
  const w = el.hover.offsetWidth;
  const h = el.hover.offsetHeight;
  const right = box.width - (box.width > 900 ? 292 : 8); // keep clear of the feed
  const left = x + 18 + w > right ? x - 18 - w : x + 18;
  const top = Math.min(Math.max(8, y - 24), box.height - h - 8);
  el.hover.style.left = `${Math.max(8, left)}px`;
  el.hover.style.top = `${top}px`;
}

/* ---------- input ---------- */

el.ask.addEventListener('submit', (ev) => {
  ev.preventDefault();
  ask(el.q.value);
});
el.q.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape' && el.q.value) {
    ev.preventDefault();
    ask('');
  }
});

el.pills.addEventListener('click', (ev) => {
  const b = (ev.target as Element).closest('button');
  if (!b) return;
  const label = b.textContent ?? '';
  if (!query) return ask(label);
  // Follow-ups narrow the current question.
  if (label.startsWith('Only ')) return ask(label.slice(5));
  if (label === 'High and critical only') return ask(`${query.text} high`);
  if (label === 'Last 6 hours') return ask(`${query.text.replace(/\b(last|past)\s+\d+\s*h(ours?)?\b/i, '').trim()} last 6 hours`);
  ask(label);
});

el.panel.addEventListener('click', (ev) => {
  const t = ev.target as Element;
  const act = t.closest<HTMLElement>('[data-act]')?.dataset.act;
  if (act === 'clear') return ask('');
  if (act === 'close') return select(null);
  const c = t.closest<HTMLElement>('[data-country]')?.dataset.country;
  if (c) ask(countries.get(c)?.name ?? c);
});

el.feed.addEventListener('click', (ev) => {
  const row = (ev.target as Element).closest<HTMLElement>('.row');
  if (row) select(Number(row.dataset.id), false);
});

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') closeMenus();
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

/* Projection */
const projButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-proj]')];
const showProjection = (p: Projection) => projButtons.forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.proj === p)));
showProjection(storedProjection());
for (const b of projButtons)
  b.addEventListener('click', () => {
    const p = b.dataset.proj as Projection;
    deskMap.setProjection(p);
    showProjection(p);
  });

$('zoom-in').addEventListener('click', () => deskMap.zoom(1));
$('zoom-out').addEventListener('click', () => deskMap.zoom(-1));

/* Menus */
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
  if (!(ev.target as Element).closest('.pop')) closeMenus();
});

/* Dictation, where the browser has it. */
type Recognition = { lang: string; interimResults: boolean; start(): void; stop(): void; onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null; onend: (() => void) | null };
const Speech = (window as unknown as { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition }).SpeechRecognition ??
  (window as unknown as { webkitSpeechRecognition?: new () => Recognition }).webkitSpeechRecognition;
if (Speech) {
  el.mic.hidden = false;
  let rec: Recognition | null = null;
  el.mic.addEventListener('click', () => {
    if (rec) return rec.stop();
    rec = new Speech();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    el.mic.classList.add('on');
    let final = false;
    rec.onresult = (e) => {
      const r = e.results[e.results.length - 1]!;
      el.q.value = Array.from({ length: e.results.length }, (_, i) => e.results[i]![0]!.transcript).join(' ');
      final = r.isFinal;
    };
    rec.onend = () => {
      el.mic.classList.remove('on');
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
    el.link.textContent = 'LIVE';
    el.link.classList.add('on');
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
    el.link.textContent = 'OFFLINE';
    el.link.classList.remove('on');
    setTimeout(connect, backoff);
    backoff = Math.min(backoff * 2, 30_000);
  };
}

function tick() {
  el.clock.textContent = `${new Date().toISOString().slice(11, 19)} UTC`;
}

tick();
setInterval(tick, 1000);
// The 24h window and the chart move on their own.
setInterval(() => {
  const before = byId.size;
  recompute();
  if (byId.size !== before) render();
  else renderChart();
}, 60_000);
void load().then(connect);
