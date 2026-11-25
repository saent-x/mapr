// The globe: a three.js sphere drawn like a printed atlas. Stippled land, coast and borders in
// ink, the night side from the real sun, spikes by sources, a density haze, "reported from" arcs
// with travelling beads, and an HTML overlay for labels, country tags and callouts.
import * as d3 from 'd3';
import type { Feature, Geometry } from 'geojson';
import * as THREE from 'three';
import { createFlat } from './flat';
import {
  calloutHTML,
  cssVar,
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

function col(name: string): THREE.Color {
  const v = cssVar(name);
  const m = /rgba?\(([^)]+)\)/.exec(v);
  if (m) {
    const p = m[1]!.split(',').map(parseFloat);
    return new THREE.Color(p[0]! / 255, p[1]! / 255, p[2]! / 255);
  }
  return new THREE.Color(v || '#888');
}

/** lon/lat on a sphere of radius r; lon 0 faces +z, the way three.js maps sphere UVs. */
function v3(lon: number, lat: number, r: number): THREE.Vector3 {
  const l = (lon * Math.PI) / 180;
  const p = (lat * Math.PI) / 180;
  const c = Math.cos(p);
  return new THREE.Vector3(c * Math.sin(l) * r, Math.sin(p) * r, c * Math.cos(l) * r);
}

const landCache = new Map<number, number[]>();
/** Evenly spread (Fibonacci) points that fall on land. */
function landPoints(n: number, land: Feature): number[] {
  const hit = landCache.get(n);
  if (hit) return hit;
  const cw = 1440;
  const ch = 720;
  const cv = document.createElement('canvas');
  cv.width = cw;
  cv.height = ch;
  const cx = cv.getContext('2d', { willReadFrequently: true })!;
  const pr = d3.geoEquirectangular().scale(cw / (2 * Math.PI)).translate([cw / 2, ch / 2]);
  cx.fillStyle = '#000';
  cx.beginPath();
  d3.geoPath(pr, cx)(land);
  cx.fill();
  const img = cx.getImageData(0, 0, cw, ch).data;
  const out: number[] = [];
  const g = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const lat = (Math.asin(y) * 180) / Math.PI;
    const lon = ((((i * g * 180) / Math.PI) % 360) + 540) % 360 - 180;
    const px = Math.floor(((lon + 180) / 360) * cw);
    const py = Math.min(ch - 1, Math.floor(((90 - lat) / 180) * ch));
    if (img[(py * cw + px) * 4 + 3]! > 128) out.push(lon, lat);
  }
  landCache.set(n, out);
  return out;
}

/** Where the sun is overhead now: [lon, lat]. */
function subsolar(ms: number): LonLat {
  const d = new Date(ms);
  const doy = (Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - Date.UTC(d.getUTCFullYear(), 0, 0)) / 864e5;
  const decl = -23.44 * Math.cos(((2 * Math.PI) / 365) * (doy + 10));
  const hrs = d.getUTCHours() + d.getUTCMinutes() / 60;
  return [(12 - hrs) * 15, decl];
}

function webgl(): boolean {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

const UP = new THREE.Vector3(0, 1, 0);
const OUT = new THREE.Vector3(0, 0, 1);

export function createGlobe(o: ViewOptions): MapView {
  if (!webgl()) return createFlat(o);
  const host = o.el;
  const W = host.clientWidth;
  const H = host.clientHeight;
  const world = getWorld();
  let data = o.data;
  let pads = { ...o.pads };
  const layers = { ...o.layers };
  let alive = true;

  const canvas = document.createElement('canvas');
  canvas.style.cssText = `position:absolute;left:0;top:0;width:${W}px;height:${H}px;cursor:grab;touch-action:none`;
  canvas.setAttribute('role', 'img');
  canvas.setAttribute('aria-label', 'Globe');
  host.appendChild(canvas);
  const overlay = d3.select(host).append('svg').attr('width', W).attr('height', H).attr('class', 'm-map').style('position', 'absolute').style('left', 0).style('top', 0).style('pointer-events', 'none');
  const labels = document.createElement('div');
  labels.className = 'd-labels';
  host.appendChild(labels);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  const ratio = Math.min(2, window.devicePixelRatio || 1);
  renderer.setPixelRatio(ratio);
  renderer.setSize(W, H, false);

  const scene = new THREE.Scene();
  const fov = 28;
  const frameW = Math.max(200, W - pads.l - pads.r);
  const frameH = Math.max(200, H - pads.t - pads.b);
  const Rpx = o.phone ? Math.min(W * 0.42, H * 0.28) : Math.max(150, Math.min(frameW * 0.42, frameH * 0.5));
  const dist = H / (2 * Math.tan((fov * Math.PI) / 360) * Rpx);
  const camera = new THREE.PerspectiveCamera(fov, W / H, 0.05, 100);
  camera.position.set(0, 0, dist);
  const tilt = new THREE.Group();
  const spin = new THREE.Group();
  tilt.add(spin);
  scene.add(tilt);
  const placeTilt = () => {
    const cxPx = (pads.l + W - pads.r) / 2;
    const cyPx = (pads.t + H - pads.b) / 2 + (o.phone ? 0 : 20);
    // Shift the picture, not the globe: an off-centre globe would slide away as the camera closes in.
    camera.setViewOffset(W, H, W / 2 - cxPx, H / 2 - cyPx, W, H);
  };
  placeTilt();
  const start = o.start ?? [28, 14];
  const rot: [number, number] = [-start[0], -start[1]];
  const applyRot = () => {
    spin.rotation.y = (rot[0] * Math.PI) / 180;
    tilt.rotation.x = (-rot[1] * Math.PI) / 180;
  };
  applyRot();

  const C = {
    surface: col('surface'),
    ink: col('ink'),
    line: col('line'),
    land: col('land'),
    signal: col('signal'),
    flash: col('flash'),
    critical: col('critical'),
    ink3: col('ink-3'),
  };
  const sun = subsolar(Date.now());
  const sunV = v3(sun[0], sun[1], 1).normalize();

  // paper sphere: soft rim shading and the night side
  const sphereMat = new THREE.ShaderMaterial({
    uniforms: { base: { value: C.surface }, shade: { value: C.ink }, sun: { value: sunV }, night: { value: layers.night ? 1 : 0 } },
    vertexShader: 'varying vec3 vN; varying vec3 vL; void main(){ vN=normalize(normalMatrix*normal); vL=normal; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader:
      'uniform vec3 base; uniform vec3 shade; uniform vec3 sun; uniform float night; varying vec3 vN; varying vec3 vL; void main(){ float rim=pow(1.0-max(vN.z,0.0),2.2); float n=smoothstep(0.08,-0.12,dot(normalize(vL),sun)); gl_FragColor=vec4(mix(base,shade,0.07*rim+0.06*n*night),1.0);\n#include <colorspace_fragment>\n}',
  });
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), sphereMat);
  spin.add(sphere);
  tilt.add(
    new THREE.Mesh(
      new THREE.SphereGeometry(1.035, 64, 48),
      new THREE.ShaderMaterial({
        uniforms: { c: { value: C.ink } },
        side: THREE.BackSide,
        transparent: true,
        depthWrite: false,
        vertexShader: 'varying vec3 vN; void main(){ vN=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
        fragmentShader: 'uniform vec3 c; varying vec3 vN; void main(){ float a=pow(1.0-abs(vN.z),3.0); gl_FragColor=vec4(c,0.07*a);\n#include <colorspace_fragment>\n}',
      }),
    ),
  );

  function lineGeo(geo: Feature | Geometry, r: number): THREE.BufferGeometry {
    const pts: THREE.Vector3[] = [];
    const ring = (cs: number[][]) => {
      for (let i = 1; i < cs.length; i++) {
        const a = cs[i - 1] as LonLat;
        const b = cs[i] as LonLat;
        const s = Math.max(1, Math.ceil(d3.geoDistance(a, b) / 0.03));
        const ip = d3.geoInterpolate(a, b);
        for (let j = 0; j < s; j++) {
          const p = ip(j / s);
          const q = ip((j + 1) / s);
          pts.push(v3(p[0], p[1], r), v3(q[0], q[1], r));
        }
      }
    };
    const walk = (g: Geometry) => {
      if (g.type === 'LineString') ring(g.coordinates);
      else if (g.type === 'MultiLineString' || g.type === 'Polygon') g.coordinates.forEach(ring);
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p) => p.forEach(ring));
      else if (g.type === 'GeometryCollection') g.geometries.forEach(walk);
    };
    walk(geo.type === 'Feature' ? geo.geometry : geo);
    return new THREE.BufferGeometry().setFromPoints(pts);
  }
  const lm = (c: THREE.Color, op = 1) => new THREE.LineBasicMaterial({ color: c, transparent: op < 1, opacity: op });
  spin.add(new THREE.LineSegments(lineGeo(d3.geoGraticule10(), 1.0015), lm(C.line)));
  spin.add(new THREE.LineSegments(lineGeo(world.borders, 1.002), lm(C.land)));
  spin.add(new THREE.LineSegments(lineGeo(world.coast, 1.0025), lm(C.ink)));
  const term = new THREE.LineSegments(
    lineGeo(d3.geoCircle().center([sun[0] + 180, -sun[1]]).radius(90)(), 1.003),
    new THREE.LineDashedMaterial({ color: C.ink3, dashSize: 0.02, gapSize: 0.02 }),
  );
  term.computeLineDistances();
  term.visible = layers.night;
  spin.add(term);
  const eq = new THREE.Mesh(new THREE.TorusGeometry(1.004, 0.0032, 6, 256), new THREE.MeshBasicMaterial({ color: C.ink }));
  eq.rotation.x = Math.PI / 2;
  spin.add(eq);
  const knobGeo = new THREE.SphereGeometry(0.014, 16, 12);
  const knobMat = new THREE.MeshBasicMaterial({ color: C.surface });
  const knobEdge = new THREE.MeshBasicMaterial({ color: C.ink, side: THREE.BackSide });
  const knobs = [0, 1].map(() => {
    const g = new THREE.Group();
    g.add(new THREE.Mesh(knobGeo, knobMat));
    const e = new THREE.Mesh(knobGeo, knobEdge);
    e.scale.setScalar(1.35);
    g.add(e);
    spin.add(g);
    return g;
  });

  // stippled land
  const lp = landPoints(o.phone ? 45000 : 70000, world.land);
  const pos = new Float32Array((lp.length / 2) * 3);
  for (let i = 0; i < lp.length; i += 2) {
    const v = v3(lp[i]!, lp[i + 1]!, 1.001);
    pos.set([v.x, v.y, v.z], (i / 2) * 3);
  }
  const lg = new THREE.BufferGeometry();
  lg.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  spin.add(new THREE.Points(lg, new THREE.PointsMaterial({ color: C.land, size: (o.phone ? 1.4 : 1.7) * ratio, sizeAttenuation: false })));

  // density haze
  const densMat = new THREE.PointsMaterial({ color: C.signal, size: (o.phone ? 1.6 : 2.2) * ratio, sizeAttenuation: false, transparent: true, opacity: 0.22, depthWrite: false });
  const density = new THREE.Points(new THREE.BufferGeometry(), densMat);
  density.visible = layers.density;
  spin.add(density);
  function densGeo(src: Mark[]) {
    const out: number[] = [];
    const rnd = d3.randomNormal.source(d3.randomLcg(0.42));
    const total = src.reduce((s, m) => s + Math.sqrt(m.k), 0) || 1;
    const per = Math.min(60, 50000 / total) * Math.min(1, (Rpx / 340) ** 2);
    for (const m of src) {
      const w = Math.sqrt(m.k);
      const g = rnd(0, 1.4 + w * 0.35);
      const n = Math.round(w * per);
      const cl = Math.max(0.2, Math.cos((m.c[1] * Math.PI) / 180));
      for (let j = 0; j < n; j++) {
        const v = v3(m.c[0] + g() / cl, m.c[1] + g(), 1.0035);
        out.push(v.x, v.y, v.z);
      }
    }
    const g2 = new THREE.BufferGeometry();
    g2.setAttribute('position', new THREE.Float32BufferAttribute(out, 3));
    return g2;
  }

  // spikes: instanced stems, caps and base rings, one set at full strength and one dimmed
  const stemGeo = new THREE.CylinderGeometry(0.0022, 0.0022, 1, 6).translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(0.005, 10, 8);
  const baseGeo = new THREE.RingGeometry(0.006, 0.0078, 24);
  interface Tip {
    m: Mark;
    n: THREE.Vector3;
    h: number;
    tip: THREE.Vector3;
  }
  let tips: Tip[] = [];
  let spikeSets: THREE.InstancedMesh[] = [];
  const spikes = new THREE.Group();
  spikes.visible = layers.events;
  spin.add(spikes);
  const tipH = (m: Mark) => Math.min(0.08, 0.01 + Math.sqrt(m.k) * 0.0065);

  let zoom = 1;
  const kOf = () => 1 / Math.max(1, zoom);
  const mtx = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const sc = new THREE.Vector3();
  function buildSpikes() {
    for (const s of spikeSets) {
      spikes.remove(s);
      s.dispose();
      (s.material as THREE.Material).dispose();
    }
    spikeSets = [];
    tips = data.marks.map((m) => {
      const n = v3(m.c[0], m.c[1], 1).normalize();
      const h = tipH(m);
      return { m, n, h, tip: n.clone().multiplyScalar(1 + h) };
    });
    const on = Q ? tips.filter((t) => Q!.match.has(t.m.key)) : tips;
    const off = Q ? tips.filter((t) => !Q!.match.has(t.m.key)) : [];
    for (const [list, op] of [
      [on, 1],
      [off, 0.12],
    ] as Array<[Tip[], number]>) {
      if (!list.length) continue;
      for (const geo of [stemGeo, capGeo, baseGeo]) {
        const mat = new THREE.MeshBasicMaterial({ transparent: op < 1, opacity: op, side: geo === baseGeo ? THREE.DoubleSide : THREE.FrontSide, depthWrite: op >= 1 });
        const im = new THREE.InstancedMesh(geo, mat, list.length);
        im.userData = { list, geo };
        list.forEach((t, i) => im.setColorAt(i, isCrit(t.m.sev) ? C.critical : C.signal));
        spikes.add(im);
        spikeSets.push(im);
      }
    }
    placeSpikes();
  }
  function placeSpikes() {
    const k = kOf();
    for (const im of spikeSets) {
      const { list, geo } = im.userData as { list: Tip[]; geo: THREE.BufferGeometry };
      list.forEach((t, i) => {
        if (geo === stemGeo) {
          q.setFromUnitVectors(UP, t.n);
          mtx.compose(t.n, q, sc.set(k, t.h, k));
        } else if (geo === capGeo) {
          mtx.compose(t.tip, q.identity(), sc.setScalar(k));
        } else {
          q.setFromUnitVectors(OUT, t.n);
          mtx.compose(t.n.clone().multiplyScalar(1.003), q, sc.setScalar(k));
        }
        im.setMatrixAt(i, mtx);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
    }
  }

  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.02, 0.026, 48), new THREE.MeshBasicMaterial({ color: C.flash, side: THREE.DoubleSide, transparent: true, depthWrite: false }));
  spin.add(pulse);
  const focusRing = new THREE.Mesh(new THREE.RingGeometry(0.06, 0.064, 64), new THREE.MeshBasicMaterial({ color: C.signal, side: THREE.DoubleSide, depthTest: false }));
  focusRing.renderOrder = 10;
  focusRing.visible = false;
  spin.add(focusRing);
  let focusKey: string | null = null;

  // "reported from" arcs with travelling beads
  const flows = new THREE.Group();
  flows.visible = layers.flows;
  spin.add(flows);
  let beads: Array<{ m: THREE.Mesh; ln: THREE.Line; key: string; pts: THREE.Vector3[]; off: number }> = [];
  const beadGeo = new THREE.SphereGeometry(0.0055, 10, 8);
  const beadMat = new THREE.MeshBasicMaterial({ color: C.signal });
  const flowMat = lm(C.signal, 0.4);
  function buildFlows() {
    for (const b of beads) {
      flows.remove(b.ln, b.m);
      b.ln.geometry.dispose();
    }
    beads = data.flows.map((f, fi) => {
      const ip = d3.geoInterpolate(f.a, f.b);
      const d = d3.geoDistance(f.a, f.b);
      const lift = Math.min(0.08, 0.01 + d * 0.06);
      const pts: THREE.Vector3[] = [];
      for (let s = 0; s <= 48; s++) {
        const t = s / 48;
        const p = ip(t);
        pts.push(v3(p[0], p[1], 1.003 + lift * Math.sin(Math.PI * t)));
      }
      const ln = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), flowMat);
      const m = new THREE.Mesh(beadGeo, beadMat);
      flows.add(ln, m);
      return { m, ln, key: f.key, pts, off: fi * 0.137 };
    });
  }

  // a question's countries, painted onto a transparent shell
  const fcv = document.createElement('canvas');
  fcv.width = 2048;
  fcv.height = 1024;
  const fctx = fcv.getContext('2d')!;
  const ftex = new THREE.CanvasTexture(fcv);
  ftex.colorSpace = THREE.SRGBColorSpace;
  ftex.anisotropy = 4;
  const fill = new THREE.Mesh(new THREE.SphereGeometry(1.0012, 128, 96), new THREE.MeshBasicMaterial({ map: ftex, transparent: true, depthWrite: false }));
  fill.visible = false;
  spin.add(fill);
  const fpr = d3.geoEquirectangular().rotate([-90, 0]).scale(2048 / (2 * Math.PI)).translate([1024, 512]);
  const fpath = d3.geoPath(fpr, fctx);
  const sig = cssVar('signal');
  function paintFill(hl: Map<string, number>) {
    fctx.clearRect(0, 0, 2048, 1024);
    for (const [a2, v] of hl) {
      const f = world.byA2.get(a2);
      if (!f) continue;
      fctx.globalAlpha = 0.1 + 0.3 * v;
      fctx.fillStyle = sig;
      fctx.beginPath();
      fpath(f);
      fctx.fill();
      fctx.globalAlpha = 0.9;
      fctx.strokeStyle = sig;
      fctx.lineWidth = 1.1;
      fctx.beginPath();
      fpath(f);
      fctx.stroke();
    }
    fctx.globalAlpha = 1;
    ftex.needsUpdate = true;
    fill.visible = hl.size > 0;
  }

  let Q: Focus | null = null;
  function applyData() {
    buildSpikes();
    const old = density.geometry;
    density.geometry = densGeo(Q ? data.marks.filter((m) => Q!.match.has(m.key)) : data.marks);
    old.dispose();
    buildFlows();
    for (const b of beads) {
      const on = !Q || Q.match.has(b.key);
      b.ln.visible = on;
      b.m.visible = on;
    }
    if (Q) paintFill(Q.hl);
    else fill.visible = false;
    placeFocus();
    dirty = true;
  }
  function placeFocus() {
    const t = focusKey ? tips.find((x) => x.m.key === focusKey) : undefined;
    focusRing.visible = !!t;
    if (t) {
      focusRing.position.copy(t.n.clone().multiplyScalar(1.004));
      focusRing.lookAt(t.n.clone().multiplyScalar(2));
    }
  }

  // camera moves
  let tween: { r0: [number, number]; r1: [number, number]; z0: number; z1: number; t0: number; dur: number; done?: () => void } | null = null;
  const maxZoom = () => Math.min(dist / 1.25, 6);
  function flyTo(lon: number, lat: number, z: number, dur: number, done?: () => void) {
    const d = ((((-lon - rot[0]) % 360) + 540) % 360) - 180;
    tween = { r0: [rot[0], rot[1]], r1: [rot[0] + d, Math.max(-75, Math.min(75, -lat))], z0: zoom, z1: z, t0: performance.now(), dur: still() ? 1 : dur, done };
  }
  function zoomFor(b: Box) {
    const c: LonLat = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const corners: LonLat[] = [
      [b[0], b[1]],
      [b[2], b[3]],
      [b[0], b[3]],
      [b[2], b[1]],
    ];
    const r = d3.max(corners, (p) => d3.geoDistance(c, p)) ?? 1;
    const z = (0.32 * H) / (Rpx * Math.sin(Math.min(Math.max(r, 0.02), 1.4)));
    return Math.max(1, Math.min(z, maxZoom(), 2.6));
  }

  // hovered country outline
  let hov: THREE.LineSegments | null = null;
  function setHover(f: CountryFeature | null) {
    if (hov) {
      spin.remove(hov);
      hov.geometry.dispose();
      hov = null;
    }
    if (f) {
      hov = new THREE.LineSegments(lineGeo(f, 1.0045), lm(C.signal));
      spin.add(hov);
    }
    dirty = true;
  }

  // overlay
  const tmp = new THREE.Vector3();
  const camDir = new THREE.Vector3();
  function toScreen(local: THREE.Vector3) {
    tmp.copy(local);
    spin.localToWorld(tmp);
    tmp.project(camera);
    return { x: ((tmp.x + 1) / 2) * W, y: ((1 - tmp.y) / 2) * H };
  }
  function facing(local: THREE.Vector3) {
    const w = local.clone();
    spin.localToWorld(w);
    const c = w.clone().sub(tilt.position).normalize();
    camDir.copy(camera.position).sub(w).normalize();
    return c.dot(camDir);
  }
  const rank = (m: Mark) => (m.key === focusKey ? 1e9 : 0) + (m.key === data.newest ? 1e8 : 0) + m.k * 10 + m.sev;

  function overlayDraw() {
    overlay.selectAll('*').remove();
    let html = '';
    const placed: Box[] = [];
    const cen: LonLat = [-rot[0], -rot[1]];
    knobs[0]!.position.copy(v3(cen[0] - 89.5, 0, 1.004));
    knobs[1]!.position.copy(v3(cen[0] + 89.5, 0, 1.004));
    const pb = { l: pads.l, r: pads.r, t: pads.t, b: pads.b };
    if (Q) {
      const cl: Array<{ x: number; y: number; c: Focus['callouts'][number] }> = [];
      for (const c of Q.callouts) {
        const t = tips.find((x) => x.m.key === c.mark.key);
        if (!t || facing(t.n) < 0.25) continue;
        const p = toScreen(t.tip);
        cl.push({ x: p.x, y: p.y, c });
      }
      if (!tween)
        for (const c of placeCallouts(cl, W, H, pb)) {
          overlay.append('path').attr('class', 'leader').attr('d', `M${c.it.x} ${c.it.y}L${c.ax} ${c.ay}`);
          overlay.append('circle').attr('class', 'call-dot').attr('cx', c.it.x).attr('cy', c.it.y).attr('r', 3);
          html += calloutHTML(c.it.c, c.x, c.y);
        }
      labels.innerHTML = html;
      return;
    }
    if (!o.phone)
      for (const h of data.hot) {
        const v = v3(h.c[0], h.c[1], 1.01);
        if (facing(v) < 0.35) continue;
        const p = toScreen(v);
        const w = 190;
        const box: Box = [p.x - w / 2, p.y + 30, p.x + w / 2, p.y + 52];
        if (box[0] < pb.l || box[2] > W - pb.r || box[3] > H - pb.b || overlaps(box, placed)) continue;
        placed.push(box);
        overlay.append('circle').attr('class', 'hot-ring').attr('cx', p.x).attr('cy', p.y).attr('r', 14);
        overlay.append('path').attr('class', 'leader').attr('d', `M${p.x} ${p.y + 14}v18`);
        html += `<span class="m-hot" style="left:${p.x}px;top:${p.y + 32}px">${esc(h.name)} · <b>${h.reports}</b> sources${h.change ? ` · <i${h.up ? ' class="up"' : ''}>${esc(h.change)}</i>` : ''}</span>`;
      }
    if (layers.events && layers.labels) {
      let nl = 0;
      const maxLabels = o.phone ? 2 : 6;
      const ranked = tips.filter((t) => facing(t.n) > 0.18).sort((a, b) => rank(b.m) - rank(a.m));
      for (const t of ranked) {
        const isNew = t.m.key === data.newest;
        const isFocus = t.m.key === focusKey;
        if (nl >= maxLabels && !isNew && !isFocus) break;
        const p = toScreen(t.tip);
        const box: Box = [p.x + 4, p.y - 11, p.x + 20 + labelWidth(t.m), p.y + 11];
        if (box[2] > W - pb.r || box[0] < pb.l || p.y < pb.t || p.y > H - pb.b) continue;
        if (overlaps(box, placed) && !isFocus) continue;
        placed.push(box);
        nl++;
        overlay.append('path').attr('class', 'leader').attr('d', `M${p.x + 3} ${p.y}h12`);
        if (isNew) overlay.append('rect').attr('class', 'tick is-flash').attr('x', p.x - 1).attr('y', p.y - 14).attr('width', 2).attr('height', 10);
        html += labelHTML(t.m, p.x + 17, p.y, !(isNew || isFocus || nl <= 2));
      }
    }
    labels.innerHTML = html;
  }

  // interaction
  let dragging = false;
  let last: [number, number] = [0, 0];
  let moved = 0;
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let pop: HTMLDivElement | null = null;
  let hovA2: string | null = null;
  function pick(evt: PointerEvent) {
    const b = canvas.getBoundingClientRect();
    const x = evt.clientX - b.left;
    const y = evt.clientY - b.top;
    ndc.set((x / W) * 2 - 1, -(y / H) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(sphere)[0];
    if (!hit) return null;
    const p = spin.worldToLocal(hit.point.clone()).normalize();
    return { ll: [(Math.atan2(p.x, p.z) * 180) / Math.PI, (Math.asin(p.y) * 180) / Math.PI] as LonLat, x, y };
  }
  function hidePop() {
    if (pop) pop.hidden = true;
  }
  function popAt(a2: string, x: number, y: number) {
    const html = o.popHTML(a2);
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
  }
  canvas.addEventListener('pointerdown', (e) => {
    dragging = true;
    moved = 0;
    tween = null;
    last = [e.clientX, e.clientY];
    canvas.setPointerCapture(e.pointerId);
    canvas.style.cursor = 'grabbing';
    hidePop();
  });
  canvas.addEventListener('pointerup', (e) => {
    dragging = false;
    canvas.style.cursor = 'grab';
    if (moved < 4) {
      // a click: pick the nearest mark on screen
      const b = canvas.getBoundingClientRect();
      const x = e.clientX - b.left;
      const y = e.clientY - b.top;
      let best: Tip | null = null;
      let bd = 14;
      for (const t of tips) {
        if (facing(t.n) < 0.1) continue;
        const p = toScreen(t.tip);
        const d = Math.hypot(p.x - x, p.y - y);
        if (d < bd) [best, bd] = [t, d];
      }
      if (best) o.onPick(best.m.key);
    }
  });
  let hoverQueued: PointerEvent | null = null;
  canvas.addEventListener('pointermove', (e) => {
    if (dragging) {
      const dx = e.clientX - last[0];
      const dy = e.clientY - last[1];
      moved += Math.abs(dx) + Math.abs(dy);
      last = [e.clientX, e.clientY];
      const s = 0.25 / zoom;
      rot[0] += dx * s;
      rot[1] = Math.max(-75, Math.min(75, rot[1] - dy * s));
      applyRot();
      dirty = true;
      return;
    }
    if (o.phone || e.pointerType === 'touch') return;
    if (!hoverQueued)
      requestAnimationFrame(() => {
        const ev = hoverQueued!;
        hoverQueued = null;
        const p = pick(ev);
        const f = p ? world.feats.find((f) => d3.geoContains(f, p.ll)) ?? null : null;
        const a2 = f ? f.properties.a2 : null;
        if (a2 !== hovA2) {
          hovA2 = a2;
          setHover(f);
        }
        if (f && p) popAt(f.properties.a2, p.x + 16, p.y + 16);
        else hidePop();
      });
    hoverQueued = e;
  });
  canvas.addEventListener('pointerleave', () => {
    hovA2 = null;
    setHover(null);
    hidePop();
  });
  canvas.addEventListener(
    'wheel',
    (e) => {
      e.preventDefault();
      tween = null;
      zoom = Math.max(0.8, Math.min(maxZoom(), zoom * (e.deltaY < 0 ? 1.1 : 0.9)));
      camera.position.z = dist / zoom;
      dirty = true;
    },
    { passive: false },
  );
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

  let dirty = true;
  const t0 = performance.now();
  let lastZ = -1;
  const home = { r: [rot[0], rot[1]] as [number, number] };
  function frame(now: number) {
    if (!alive) return;
    const t = (now - t0) / 1000;
    if (tween) {
      const u = Math.min(1, (now - tween.t0) / tween.dur);
      const e = d3.easeCubicInOut(u);
      rot[0] = tween.r0[0] + (tween.r1[0] - tween.r0[0]) * e;
      rot[1] = tween.r0[1] + (tween.r1[1] - tween.r0[1]) * e;
      zoom = (tween.z0 + (tween.z1 - tween.z0) * e) * (1 - 0.28 * Math.sin(Math.PI * e) * (Math.abs(tween.r1[0] - tween.r0[0]) > 25 ? 1 : 0.3));
      camera.position.z = dist / zoom;
      applyRot();
      dirty = true;
      if (u >= 1) {
        const dn = tween.done;
        tween = null;
        dirty = true;
        dn?.();
      }
    } else if (!still() && !dragging && !Q && !focusKey && !hovA2) {
      rot[0] += 0.035;
      applyRot();
      dirty = true;
    }
    if (layers.flows && !still())
      for (const b of beads) {
        const u = (((t * 0.22 + b.off) % 1) + 1) % 1;
        b.m.position.copy(b.pts[Math.floor(u * (b.pts.length - 1))]!);
      }
    const nt = data.newest && !Q ? tips.find((x) => x.m.key === data.newest) : undefined;
    if (nt && !still()) {
      const u = (((t % 1.6) + 1.6) % 1.6) / 1.6;
      pulse.visible = true;
      pulse.position.copy(nt.n.clone().multiplyScalar(1.004));
      pulse.lookAt(nt.n.clone().multiplyScalar(2));
      pulse.scale.setScalar((1 + u * 3) * kOf());
      (pulse.material as THREE.MeshBasicMaterial).opacity = 1 - u;
    } else pulse.visible = false;
    if (zoom !== lastZ) {
      lastZ = zoom;
      placeSpikes();
      const k = kOf();
      for (const b of beads) b.m.scale.setScalar(k);
      focusRing.scale.setScalar(k);
    }
    renderer.render(scene, camera);
    if (dirty) {
      overlayDraw();
      dirty = false;
    }
    requestAnimationFrame(frame);
  }
  applyData();
  requestAnimationFrame(frame);

  return {
    setData(d: MapData) {
      data = d;
      applyData();
    },
    setLayer(k: Layer, on: boolean) {
      layers[k] = on;
      density.visible = layers.density;
      flows.visible = layers.flows;
      spikes.visible = layers.events;
      term.visible = layers.night;
      sphereMat.uniforms.night!.value = layers.night ? 1 : 0;
      dirty = true;
    },
    setPads(p) {
      pads = { ...p };
      placeTilt();
      dirty = true;
    },
    query(f, done) {
      Q = f;
      focusKey = null;
      hidePop();
      applyData();
      if (f) flyTo(f.center[0], f.center[1], zoomFor(f.bbox), 1700, done);
      else flyTo(-home.r[0], -home.r[1], 1, 1400, done);
    },
    flyTo(c: LonLat) {
      flyTo(c[0], c[1], Math.max(zoom, Math.min(maxZoom(), 1.8)), 1200);
    },
    setFocus(key) {
      focusKey = key;
      placeFocus();
      dirty = true;
    },
    zoomBy(f: number) {
      flyTo(-rot[0], -rot[1], Math.max(0.8, Math.min(maxZoom(), zoom * f)), 400);
    },
    center() {
      return [-rot[0], -rot[1]];
    },
    destroy() {
      alive = false;
      renderer.dispose();
      try {
        renderer.forceContextLoss();
      } catch {
        /* already gone */
      }
      host.innerHTML = '';
    },
  };
}
