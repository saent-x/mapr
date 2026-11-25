// The flat sheet: Equal Earth, stippled land, density contours, "reported from" arcs and
// spikes by sources. A question flies the sheet to its area and pins numbered callouts.
import * as d3 from 'd3';
import type { Feature } from 'geojson';
import {
  calloutHTML,
  esc,
  isCrit,
  labelHTML,
  labelWidth,
  overlaps,
  placeCallouts,
  still,
  type Box,
  type Focus,
  type Layer,
  type LonLat,
  type MapData,
  type MapView,
  type Mark,
  type ViewOptions,
} from './shared';
import { getWorld, type CountryFeature } from './world';

let uid = 0;

export function createFlat(o: ViewOptions): MapView {
  const host = o.el;
  const W = host.clientWidth;
  const H = host.clientHeight;
  const world = getWorld();
  const id = `st${++uid}`;
  let data = o.data;
  let pads = { ...o.pads };
  const layers = { ...o.layers };
  let Q: Focus | null = null;
  let focusKey: string | null = null;
  let moving = false;
  let timer: d3.Timer | null = null;

  const svg = d3.select(host).append('svg').attr('class', 'm-map').attr('width', W).attr('height', H).attr('role', 'img').attr('aria-label', 'Map');
  const pat = svg.append('defs').append('pattern').attr('id', id).attr('width', 4).attr('height', 4).attr('patternUnits', 'userSpaceOnUse');
  pat.append('circle').attr('class', 'dot').attr('cx', 1).attr('cy', 1).attr('r', 0.7);
  const labels = document.createElement('div');
  labels.className = 'd-labels';
  host.appendChild(labels);

  const proj = d3.geoEqualEarth();
  const ext: Box = [-125, -40, 150, 66];
  const boxFeature = (b: Box): Feature => ({
    type: 'Feature',
    properties: {},
    geometry: { type: 'MultiPoint', coordinates: [[b[0], b[1]], [b[2], b[3]], [b[0], b[3]], [b[2], b[1]], [(b[0] + b[2]) / 2, b[3]], [(b[0] + b[2]) / 2, b[1]]] },
  });
  const fitBox = (b: Box) => {
    const tp = d3.geoEqualEarth().fitExtent([[pads.l, pads.t + 12], [W - pads.r, H - pads.b - 12]], boxFeature(b));
    return { s: tp.scale(), t: tp.translate() as [number, number] };
  };
  const home0 = fitBox(ext);
  proj.scale(home0.s).translate(home0.t);
  let home = home0;
  const path = d3.geoPath(proj);

  const gS = svg.append('path').attr('class', 'sphere').style('stroke', 'var(--line)').style('stroke-width', 1);
  const gG = svg.append('path').attr('class', 'grat');
  const gC = svg
    .append('g')
    .selectAll<SVGPathElement, CountryFeature>('path')
    .data(world.feats)
    .join('path')
    .attr('class', 'country')
    .attr('fill', `url(#${id})`);
  const gH = svg.append('g');
  const gB = svg.append('path').attr('class', 'grat').style('stroke', 'var(--land)');
  const gL = svg.append('path').attr('class', 'land').attr('fill', 'none');
  const gHov = svg.append('path').attr('class', 'region-on').style('pointer-events', 'none');
  const gR = svg.append('path').attr('class', 'ring').style('stroke-width', 1);
  const gD = svg.append('g');
  const gF = svg.append('g');
  const gE = svg.append('g');
  const grat = d3.geoGraticule10();
  const equator = { type: 'LineString' as const, coordinates: d3.range(-180, 181, 2).map((x) => [x, 0]) };

  function drawLayers() {
    gD.selectAll('*').remove();
    gF.selectAll('*').remove();
    const src = Q ? data.marks.filter((m) => Q!.match.has(m.key)) : data.marks;
    if (layers.density && src.length) {
      const pts: Array<[number, number, number]> = [];
      for (const m of src) {
        const p = proj(m.c);
        if (p) pts.push([p[0], p[1], Math.sqrt(m.k)]);
      }
      const cs = d3
        .contourDensity<[number, number, number]>()
        .x((d) => d[0])
        .y((d) => d[1])
        .weight((d) => d[2])
        .size([W, H])
        .bandwidth(Math.max(14, proj.scale() / 9))
        .thresholds(7)(pts);
      const mx = d3.max(cs, (c) => c.value) || 1;
      gD.selectAll('path')
        .data(cs)
        .join('path')
        .attr('d', d3.geoPath())
        .attr('class', 'iso')
        .style('fill-opacity', (c) => 0.04 + (0.16 * c.value) / mx);
    }
    if (layers.flows) {
      for (const f of data.flows) {
        if (Q && !Q.match.has(f.key)) continue;
        const a = proj(f.a);
        const b = proj(f.b);
        if (!a || !b) continue;
        const mx2 = (a[0] + b[0]) / 2;
        const my = (a[1] + b[1]) / 2;
        const lift = Math.max(16, Math.hypot(b[0] - a[0], b[1] - a[1]) * 0.3);
        gF.append('path').attr('class', 'flow').attr('d', `M${a[0]} ${a[1]}Q${mx2} ${my - lift} ${b[0]} ${b[1]}`);
        gF.append('circle').attr('class', 'flow-end').attr('cx', a[0]).attr('cy', a[1]).attr('r', 2.5);
      }
    }
  }

  function draw() {
    gS.attr('d', path({ type: 'Sphere' }));
    gG.attr('d', path(grat));
    gC.attr('d', path);
    gB.attr('d', path(world.borders));
    gL.attr('d', path(world.coast));
    gR.attr('d', path(equator));
    const hl = Q ? Q.hl : new Map<string, number>();
    gH.selectAll<SVGPathElement, string>('path')
      .data([...hl.keys()])
      .join('path')
      .attr('class', 'region-on')
      .style('pointer-events', 'none')
      .style('fill-opacity', (k) => 0.35 + 0.65 * hl.get(k)!)
      .style('stroke-opacity', (k) => 0.4 + 0.6 * hl.get(k)!)
      .attr('d', (k) => {
        const f = world.byA2.get(k);
        return f ? path(f) : null;
      });
    drawLayers();
    drawMarks();
  }

  function drawMarks() {
    gE.selectAll('*').remove();
    gE.style('display', layers.events ? 'inline' : 'none');
    let html = '';
    if (!layers.events) {
      labels.innerHTML = '';
      return;
    }
    const placed: Box[] = [];
    let dim = '';
    let plus = '';
    let crit = '';
    const calls: Array<{ x: number; y: number; c: Focus['callouts'][number] }> = [];
    const callKeys = new Map(Q ? Q.callouts.map((c) => [c.mark.key, c]) : []);
    const ranked = data.marks
      .map((m) => ({ m, p: proj(m.c) }))
      .filter((x): x is { m: Mark; p: [number, number] } => !!x.p && x.p[0] > -20 && x.p[1] > -20 && x.p[0] < W + 20 && x.p[1] < H + 20)
      .sort((a, b) => rank(b.m) - rank(a.m));
    let nl = 0;
    const maxLabels = o.phone ? 3 : 6;
    for (const { m, p } of ranked) {
      const [px, py] = p;
      const isNew = m.key === data.newest && !Q;
      const isFocus = m.key === focusKey;
      if (Q && !Q.match.has(m.key)) {
        dim += `M${px - 4} ${py}h8M${px} ${py - 4}v8`;
        continue;
      }
      const sh = Math.min(64, 10 + Math.sqrt(m.k) * 7);
      const cls = isCrit(m.sev) ? ' is-crit' : '';
      const call = callKeys.get(m.key);
      if (call) {
        gE.append('path').attr('class', `spike${cls}`).attr('d', `M${px} ${py}V${py - sh}`);
        gE.append('circle').attr('class', `spike-cap${cls}`).attr('cx', px).attr('cy', py - sh).attr('r', 2.6);
        calls.push({ x: px, y: py - sh, c: call });
        continue;
      }
      if (isNew || isFocus) gE.append('circle').attr('class', 'halo').attr('cx', px).attr('cy', py).attr('r', isFocus ? 16 : 11);
      if (isFocus) gE.append('circle').attr('class', 'focus-ring').attr('cx', px).attr('cy', py).attr('r', 26);
      const d = `M${px - 5} ${py}h10M${px} ${py - 5}v10`;
      if (isCrit(m.sev)) crit += d;
      else plus += d;
      if (!layers.labels || (nl >= maxLabels && !isNew && !isFocus)) continue;
      const ty = py - sh;
      const ex = px + 3;
      const box: Box = [px - 6, ty - 11, ex + 15 + labelWidth(m), py + 4];
      if (box[2] > W - pads.r || box[0] < pads.l || ty < pads.t) continue;
      if (overlaps(box, placed) && !isFocus) continue;
      placed.push(box);
      nl++;
      gE.append('path').attr('class', `spike${cls}`).attr('d', `M${px} ${py}V${ty}`);
      gE.append('circle').attr('class', `spike-cap${cls}`).attr('cx', px).attr('cy', ty).attr('r', 2.6);
      if (isNew) gE.append('rect').attr('class', 'tick is-flash').attr('x', px - 7).attr('y', ty - 5).attr('width', 2).attr('height', 10);
      gE.append('path').attr('class', 'leader').attr('d', `M${ex + 1} ${ty}h12`);
      html += labelHTML(m, ex + 15, ty, !(isNew || isFocus || nl <= 2));
    }
    gE.insert('path', ':first-child').attr('class', 'plus dim').attr('d', dim || null);
    gE.insert('path', ':first-child').attr('class', 'plus crit').attr('d', crit || null);
    gE.insert('path', ':first-child').attr('class', 'plus').attr('d', plus || null);
    if (calls.length && !moving) {
      calls.sort((a, b) => a.c.n - b.c.n);
      for (const c of placeCallouts(calls, W, H, { l: pads.l, r: pads.r, t: pads.t, b: pads.b })) {
        gE.append('path').attr('class', 'leader').attr('d', `M${c.it.x} ${c.it.y}L${c.ax} ${c.ay}`);
        html += calloutHTML(c.it.c, c.x, c.y);
      }
    }
    labels.innerHTML = html;
  }

  const rank = (m: Mark) => (m.key === focusKey ? 1e9 : 0) + (m.key === data.newest ? 1e8 : 0) + m.k * 10 + m.sev;

  function fly(target: { s: number; t: [number, number] }, dur: number, done?: () => void) {
    timer?.stop();
    const s0 = proj.scale();
    const s1 = target.s;
    const it = d3.interpolate(proj.translate() as [number, number], target.t);
    const mid = Math.min(s0, s1) * 0.82;
    const far = s1 > s0 * 1.6 || s0 > s1 * 1.6 ? 1 : 0.3;
    moving = true;
    labels.innerHTML = '';
    const instant = still();
    timer = d3.timer((el) => {
      const u = instant ? 1 : Math.min(1, el / dur);
      const e = d3.easeCubicInOut(u);
      let sc = s0 + (s1 - s0) * e;
      sc -= (sc - mid) * Math.sin(Math.PI * e) * 0.5 * far;
      proj.scale(sc).translate(it(e));
      if (u >= 1) {
        timer?.stop();
        timer = null;
        moving = false;
        draw();
        done?.();
      } else draw();
    });
  }

  const clampScale = (s: number) => Math.max(home0.s * 0.8, Math.min(home0.s * 14, s));

  // hover card
  let pop: HTMLDivElement | null = null;
  function showPop(f: CountryFeature, x: number, y: number) {
    const html = o.popHTML(f.properties.a2);
    if (!html) return hidePop();
    if (!pop) {
      pop = document.createElement('div');
      pop.className = 'd-pop';
      host.appendChild(pop);
    }
    pop.innerHTML = html;
    pop.hidden = false;
    const w = pop.offsetWidth;
    const h = pop.offsetHeight;
    if (x + w > W - 8) x -= w + 32;
    if (y + h > H - 8) y = Math.max(8, H - h - 8);
    pop.style.left = `${x}px`;
    pop.style.top = `${y}px`;
    gHov.attr('d', path(f));
  }
  function hidePop() {
    if (pop) pop.hidden = true;
    gHov.attr('d', null);
  }
  if (!o.phone) {
    gC.on('mousemove', (evt: MouseEvent, f) => {
      if (dragging) return;
      const b = host.getBoundingClientRect();
      showPop(f, evt.clientX - b.left + 16, evt.clientY - b.top + 16);
    }).on('mouseleave', hidePop);
  }

  // pan and zoom
  let dragging = false;
  svg.style('cursor', 'grab').call(
    d3
      .drag<SVGSVGElement, unknown>()
      .on('start', () => {
        dragging = true;
        timer?.stop();
        hidePop();
        svg.style('cursor', 'grabbing');
      })
      .on('drag', (evt: d3.D3DragEvent<SVGSVGElement, unknown, unknown>) => {
        const t = proj.translate();
        proj.translate([t[0] + evt.dx, t[1] + evt.dy]);
        draw();
      })
      .on('end', () => {
        dragging = false;
        svg.style('cursor', 'grab');
      }),
  );
  host.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      const b = host.getBoundingClientRect();
      zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, [e.clientX - b.left, e.clientY - b.top], 0);
    },
    { passive: false },
  );
  function zoomAt(f: number, c: [number, number], dur: number) {
    const s = clampScale(proj.scale() * f);
    const k = s / proj.scale();
    const t = proj.translate();
    const target = { s, t: [c[0] + (t[0] - c[0]) * k, c[1] + (t[1] - c[1]) * k] as [number, number] };
    if (!dur) {
      proj.scale(target.s).translate(target.t);
      draw();
    } else fly(target, dur);
  }

  labels.addEventListener('click', (e) => {
    const t = e.target as Element;
    const c = t.closest<HTMLElement>('[data-callout]');
    if (c && Q) {
      const call = Q.callouts[Number(c.dataset.callout)];
      if (call) o.onPick(call.mark.key, call.ev.id);
      return;
    }
    const l = t.closest<HTMLElement>('[data-key]');
    if (l) o.onPick(l.dataset.key!);
  });

  draw();

  return {
    setData(d: MapData) {
      data = d;
      if (!moving) draw();
    },
    setLayer(k: Layer, on: boolean) {
      layers[k] = on;
      draw();
    },
    setPads(p) {
      pads = { ...p };
      home = fitBox(ext);
      if (!moving) draw();
    },
    query(f, done) {
      Q = f;
      focusKey = null;
      hidePop();
      if (!f) return fly(home, 1200, done);
      const t = fitBox(f.bbox);
      t.s = Math.min(t.s, home0.s * 9);
      if (t.s === home0.s * 9) {
        const tp = d3.geoEqualEarth().scale(t.s).translate([0, 0]);
        const p = tp(f.center)!;
        t.t = [(pads.l + W - pads.r) / 2 - p[0], (pads.t + H - pads.b) / 2 - p[1]];
      }
      fly(t, 1500, done);
    },
    flyTo(c: LonLat) {
      const s = Math.max(proj.scale(), home0.s * 3.2);
      const tp = d3.geoEqualEarth().scale(s).translate([0, 0]);
      const p = tp(c)!;
      fly({ s, t: [(pads.l + W - pads.r) / 2 - p[0], (pads.t + H - pads.b) / 2 - p[1]] }, 1100);
    },
    setFocus(key) {
      focusKey = key;
      if (!moving) draw();
    },
    zoomBy(f: number) {
      zoomAt(f, [(pads.l + W - pads.r) / 2, (pads.t + H - pads.b) / 2], 450);
    },
    center() {
      const c = proj.invert?.([(pads.l + W - pads.r) / 2, (pads.t + H - pads.b) / 2]);
      return c ? [c[0], c[1]] : [20, 15];
    },
    destroy() {
      timer?.stop();
      host.innerHTML = '';
    },
  };
}

