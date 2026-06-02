/* Map engine: equirectangular SVG + orthographic globe, drag-rotate, zoom
   Loads world-atlas countries-110m TopoJSON at runtime from CDN with fallback.
*/
const { useState, useEffect, useRef, useMemo, useCallback } = React;

// -------- Projection helpers --------
const degToRad = (d) => d * Math.PI / 180;

// Equirectangular: lon [-180,180] → [0,W], lat [90,-90] → [0,H]
function projectEqui(lon, lat, W, H, pan=[0,0], scale=1) {
  const cx = W/2 + pan[0], cy = H/2 + pan[1];
  return [
    cx + (lon / 180) * (W/2) * scale,
    cy - (lat / 90)  * (H/2) * scale,
  ];
}
function unprojectEqui(x, y, W, H, pan=[0,0], scale=1) {
  const cx = W/2 + pan[0], cy = H/2 + pan[1];
  return [
    ((x - cx) / ((W/2) * scale)) * 180,
    -((y - cy) / ((H/2) * scale)) * 90,
  ];
}

// Orthographic (globe): rotate by [λ,φ], then project to viewport
function projectOrtho(lon, lat, W, H, rot=[0,0], radius) {
  const λ = degToRad(lon - rot[0]);
  const φ = degToRad(lat);
  const φ0 = degToRad(-rot[1]);
  const cosC = Math.sin(φ0)*Math.sin(φ) + Math.cos(φ0)*Math.cos(φ)*Math.cos(λ);
  if (cosC < 0) return null; // back-face
  const x = Math.cos(φ) * Math.sin(λ);
  const y = Math.cos(φ0)*Math.sin(φ) - Math.sin(φ0)*Math.cos(φ)*Math.cos(λ);
  return [W/2 + radius * x, H/2 - radius * y];
}

// Convert TopoJSON arcs → array of [lon,lat] rings per country
function topoToCountries(topo) {
  if (!topo || !topo.objects) return [];
  const key = topo.objects.countries ? "countries" : Object.keys(topo.objects)[0];
  const geom = topo.objects[key];
  const t = topo.transform || { scale:[1,1], translate:[0,0] };
  const arcs = topo.arcs.map(arc => {
    let x = 0, y = 0;
    return arc.map(([dx,dy]) => {
      x += dx; y += dy;
      return [x * t.scale[0] + t.translate[0], y * t.scale[1] + t.translate[1]];
    });
  });
  const resolveArc = (i) => i < 0 ? arcs[~i].slice().reverse() : arcs[i];
  const out = [];
  for (const g of geom.geometries) {
    const polys = [];
    const pushPoly = (polygon) => {
      polys.push(polygon.map(ring => {
        const pts = [];
        for (const ai of ring) {
          const arc = resolveArc(ai);
          if (pts.length) pts.push(...arc.slice(1)); else pts.push(...arc);
        }
        return pts;
      }));
    };
    if (g.type === "Polygon") pushPoly(g.arcs);
    else if (g.type === "MultiPolygon") g.arcs.forEach(pushPoly);
    out.push({
      id: g.id,
      name: g.properties?.name || g.properties?.NAME || String(g.id),
      polys,
    });
  }
  return out;
}

// Build SVG path from a list of rings, using a projector that may return null (back-face)
function ringsToPath(rings, projector) {
  let d = "";
  for (const ring of rings) {
    let started = false;
    let lastVisible = false;
    for (let i=0;i<ring.length;i++){
      const p = projector(ring[i][0], ring[i][1]);
      if (p === null) { started = false; lastVisible = false; continue; }
      if (!lastVisible) {
        d += `M${p[0].toFixed(1)},${p[1].toFixed(1)}`;
        started = true;
      } else {
        d += `L${p[0].toFixed(1)},${p[1].toFixed(1)}`;
      }
      lastVisible = true;
    }
    if (started) d += "Z";
  }
  return d;
}

// Graticule (lat/lon grid) points
function graticule(step=15) {
  const lines = [];
  for (let lon = -180; lon <= 180; lon += step) {
    const pts = [];
    for (let lat = -90; lat <= 90; lat += 5) pts.push([lon, lat]);
    lines.push(pts);
  }
  for (let lat = -75; lat <= 75; lat += step) {
    const pts = [];
    for (let lon = -180; lon <= 180; lon += 5) pts.push([lon, lat]);
    lines.push(pts);
  }
  return lines;
}

// Fallback world (extremely simplified) if CDN blocked — just a blob per continent
const FALLBACK_WORLD = [
  { id: "NAM", name: "N. America", polys: [[[[-168,70],[-52,70],[-52,15],[-105,8],[-168,55],[-168,70]]]] },
  { id: "SAM", name: "S. America", polys: [[[[-82,12],[-34,12],[-34,-20],[-70,-56],[-82,-18],[-82,12]]]] },
  { id: "EUR", name: "Europe",     polys: [[[[-10,72],[45,72],[45,35],[-10,35],[-10,72]]]] },
  { id: "AFR", name: "Africa",     polys: [[[[-18,37],[52,37],[52,-10],[18,-35],[-18,5],[-18,37]]]] },
  { id: "ASI", name: "Asia",       polys: [[[[45,72],[180,72],[180,0],[100,-10],[45,35],[45,72]]]] },
  { id: "OCE", name: "Oceania",    polys: [[[[110,-10],[155,-10],[155,-45],[115,-40],[110,-10]]]] },
];

// --- Hooks ---
function useSize(ref) {
  const [size, setSize] = useState({ w: 0, h: 0 });
  React.useLayoutEffect(() => {
    if (!ref.current) return;
    const measure = () => {
      const r = ref.current.getBoundingClientRect();
      setSize({ w: r.width, h: r.height });
    };
    measure();
    const ro = new ResizeObserver(entries => {
      for (const e of entries) setSize({ w: e.contentRect.width, h: e.contentRect.height });
    });
    ro.observe(ref.current);
    // retry once on next frame in case layout wasn't committed
    const raf = requestAnimationFrame(measure);
    return () => { ro.disconnect(); cancelAnimationFrame(raf); };
  }, []);
  return size;
}

function useWorldData() {
  const [countries, setCountries] = useState(null);
  useEffect(() => {
    let cancelled = false;
    async function load() {
      const urls = [
        "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
        "https://unpkg.com/world-atlas@2/countries-110m.json",
      ];
      for (const u of urls) {
        try {
          const r = await fetch(u);
          if (!r.ok) continue;
          const topo = await r.json();
          if (cancelled) return;
          setCountries(topoToCountries(topo));
          return;
        } catch(e) { /* try next */ }
      }
      if (!cancelled) setCountries(FALLBACK_WORLD);
    }
    load();
    return () => { cancelled = true; };
  }, []);
  return countries;
}

// ======== FLAT MAP (Equirectangular) ========
function FlatMap({ events, onEventClick, onRegionClick, activeEvent, layers, selectedIso, heatScale=1 }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const countries = useWorldData();
  const [pan, setPan] = useState([0, 0]);
  const [scale, setScale] = useState(1);
  const [dragging, setDragging] = useState(false);
  const [coords, setCoords] = useState(null);

  const W = Math.max(1, w), H = Math.max(1, h);

  // Drag to pan
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start = null;
    const down = (e) => { start = { x: e.clientX, y: e.clientY, pan: [...pan] }; setDragging(true); };
    const move = (e) => {
      if (!ref.current) return;
      const r = ref.current.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      setCoords(unprojectEqui(x, y, W, H, pan, scale));
      if (!start) return;
      setPan([start.pan[0] + (e.clientX - start.x), start.pan[1] + (e.clientY - start.y)]);
    };
    const up = () => { start = null; setDragging(false); };
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [pan, scale, W, H]);

  const wheelHandler = useCallback((e) => {
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setScale(s => Math.max(0.5, Math.min(6, s * (1 + delta))));
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.addEventListener("wheel", wheelHandler, { passive: false });
    return () => el.removeEventListener("wheel", wheelHandler);
  }, [wheelHandler]);

  const proj = (lon, lat) => projectEqui(lon, lat, W, H, pan, scale);

  const gratPaths = useMemo(() => {
    return graticule(20).map(line => {
      let d = "";
      for (let i=0;i<line.length;i++){
        const [x,y] = proj(line[i][0], line[i][1]);
        d += (i===0?"M":"L") + x.toFixed(1) + "," + y.toFixed(1);
      }
      return d;
    });
  }, [W, H, pan, scale]);

  const countryPaths = useMemo(() => {
    if (!countries) return [];
    return countries.map((c,i) => ({
      id: c.id,
      uid: (c.id != null ? String(c.id) : "c") + "-" + i,
      name: c.name,
      d: ringsToPath([].concat(...c.polys), (lon,lat) => proj(lon, lat)),
    }));
  }, [countries, W, H, pan, scale]);

  // Aggregate severity by country for coverage/severity layer
  const countrySev = useMemo(() => {
    const m = new Map();
    for (const e of events) {
      if (!m.has(e.iso)) m.set(e.iso, { total: 0, count: 0 });
      const entry = m.get(e.iso);
      entry.total += e.sev; entry.count += 1;
    }
    return m;
  }, [events]);

  // Heat blobs (severity layer)
  const heatBlobs = useMemo(() => {
    if (!layers.sev) return null;
    return events.map(e => {
      const [x, y] = proj(e.lon, e.lat);
      const r = (10 + e.sev * 8) * heatScale;
      const color = e.tier === "red" || e.tier === "black" ? "rgba(217,83,59,0.35)"
                  : e.tier === "amber" ? "rgba(232,163,61,0.30)"
                  : "rgba(61,155,107,0.22)";
      return { cx: x, cy: y, r, color, id: e.id };
    });
  }, [events, W, H, pan, scale, layers.sev, heatScale]);

  return (
    <div className="map-stage" ref={ref}>
      {!countries && <div className="map-loading">LOADING CARTOGRAPHY…</div>}
      <svg className="map-svg" width={W} height={H}>
        {/* Graticule */}
        {layers.geo && gratPaths.map((d,i) => (
          <path key={i} className="map-graticule" d={d} />
        ))}

        {/* Countries */}
        <g>
          {countryPaths.map(c => (
            <path
              key={c.uid}
              className="map-country"
              d={c.d}
              data-iso={c.id}
              data-selected={selectedIso === c.id}
              onClick={(e) => { e.stopPropagation(); onRegionClick && onRegionClick(c); }}
            >
              <title>{c.name}</title>
            </path>
          ))}
        </g>

        {/* Coverage layer — density dots */}
        {layers.cov && events.map(e => {
          const [x,y] = proj(e.lon, e.lat);
          return <circle key={"cov"+e.id} cx={x} cy={y} r={1.5} fill="var(--cyan)" opacity="0.55" className="cov-country" />;
        })}

        {/* Severity heat blobs */}
        {heatBlobs && (
          <g>
            <defs>
              <filter id="heatBlur" x="-50%" y="-50%" width="200%" height="200%">
                <feGaussianBlur stdDeviation="6" />
              </filter>
            </defs>
            <g filter="url(#heatBlur)">
              {heatBlobs.map(b => (
                <circle key={b.id} className="heat-blob" cx={b.cx} cy={b.cy} r={b.r} fill={b.color} />
              ))}
            </g>
          </g>
        )}

        {/* Event markers */}
        <g>
          {events.map(e => {
            const [x,y] = proj(e.lon, e.lat);
            const sevClass = `sev-${e.tier}`;
            const isLive = (Date.now() - e.ts) < 1000*60*60; // within last hr
            const r = 2 + e.sev * 0.45;
            return (
              <g key={e.id}
                 className={`evt-marker ${sevClass}`}
                 data-live={isLive}
                 transform={`translate(${x},${y})`}
                 onClick={(ev) => { ev.stopPropagation(); onEventClick && onEventClick(e); }}>
                <circle className="pulse" r={3} />
                <circle className="core" r={r} />
                {activeEvent === e.id && <circle className="core" r={r + 3} fill="none" stroke="var(--amber)" strokeWidth="1" />}
              </g>
            );
          })}
        </g>
      </svg>

      <div className="map-chrome">
        <div className="map-corner tl">
          <div>EQUIRECTANGULAR · WGS84</div>
          <div style={{color:"var(--ink-0)", marginTop: 4}}>MAP · FLAT</div>
        </div>
        <div className="map-corner tr map-coords">
          <div>CURSOR</div>
          {coords ? (
            <>
              <div><b>{coords[1].toFixed(3)}°</b> {coords[1] >= 0 ? "N" : "S"}</div>
              <div><b>{coords[0].toFixed(3)}°</b> {coords[0] >= 0 ? "E" : "W"}</div>
            </>
          ) : <div>—</div>}
        </div>
        <div className="map-corner bl">
          <div>ZOOM · {scale.toFixed(2)}×</div>
        </div>
      </div>
    </div>
  );
}

// ======== GLOBE (Orthographic, drag-rotate) ========
function GlobeMap({ events, onEventClick, onRegionClick, activeEvent, layers, selectedIso }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const countries = useWorldData();
  const [rot, setRot] = useState([20, -10]);
  const [zoom, setZoom] = useState(1);

  const W = Math.max(1, w), H = Math.max(1, h);
  const radius = Math.min(W, H) * 0.38 * zoom;

  // Auto rotate slightly
  useEffect(() => {
    let raf;
    let last = performance.now();
    let active = true;
    const tick = (t) => {
      if (!active) return;
      const dt = (t - last) / 1000; last = t;
      setRot(r => [r[0] + dt * 3, r[1]]); // 3 deg/sec
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { active = false; cancelAnimationFrame(raf); };
  }, []);

  // Drag to rotate
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let start = null;
    const down = (e) => { start = { x: e.clientX, y: e.clientY, rot: [...rot] }; };
    const move = (e) => {
      if (!start) return;
      const dx = e.clientX - start.x, dy = e.clientY - start.y;
      setRot([start.rot[0] + dx * 0.4, Math.max(-85, Math.min(85, start.rot[1] + dy * 0.4))]);
    };
    const up = () => { start = null; };
    el.addEventListener("mousedown", down);
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", up);
    return () => {
      el.removeEventListener("mousedown", down);
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", up);
    };
  }, [rot]);

  useEffect(() => {
    const el = ref.current; if (!el) return;
    const wheel = (e) => { e.preventDefault(); setZoom(z => Math.max(0.5, Math.min(3, z * (1 - e.deltaY*0.002)))); };
    el.addEventListener("wheel", wheel, { passive: false });
    return () => el.removeEventListener("wheel", wheel);
  }, []);

  const proj = (lon,lat) => projectOrtho(lon, lat, W, H, rot, radius);

  const gratPaths = useMemo(() => {
    return graticule(15).map(line => {
      let d = "", seg = false;
      for (const [lon,lat] of line) {
        const p = proj(lon, lat);
        if (p === null) { seg = false; continue; }
        d += (seg?"L":"M") + p[0].toFixed(1) + "," + p[1].toFixed(1);
        seg = true;
      }
      return d;
    });
  }, [W, H, rot, radius]);

  const countryPaths = useMemo(() => {
    if (!countries) return [];
    return countries.map((c,i) => ({
      id: c.id,
      uid: (c.id != null ? String(c.id) : "c") + "-" + i,
      name: c.name,
      d: ringsToPath([].concat(...c.polys), (lon,lat)=>proj(lon,lat)),
    }));
  }, [countries, W, H, rot, radius]);

  return (
    <div className="map-stage" ref={ref}>
      {!countries && <div className="map-loading">LOADING CARTOGRAPHY…</div>}
      <svg className="map-svg" width={W} height={H}>
        <defs>
          <radialGradient id="sphereGlow" cx="50%" cy="50%" r="50%">
            <stop offset="70%" stopColor="var(--bg-1)" />
            <stop offset="100%" stopColor="var(--bg-0)" />
          </radialGradient>
          <filter id="heatBlur2" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="5" />
          </filter>
        </defs>
        <circle className="map-sphere" cx={W/2} cy={H/2} r={radius} fill="url(#sphereGlow)" />
        {layers.geo && gratPaths.map((d,i) => <path key={i} className="map-graticule" d={d} />)}
        <g>
          {countryPaths.map(c => (
            <path key={c.uid} className="map-country" d={c.d}
              data-iso={c.id}
              data-selected={selectedIso === c.id}
              onClick={(e)=>{ e.stopPropagation(); onRegionClick && onRegionClick(c); }}>
              <title>{c.name}</title>
            </path>
          ))}
        </g>
        {layers.sev && (
          <g filter="url(#heatBlur2)">
            {events.map(e => {
              const p = proj(e.lon, e.lat);
              if (!p) return null;
              const color = e.tier==="red"||e.tier==="black" ? "rgba(217,83,59,0.35)"
                          : e.tier==="amber" ? "rgba(232,163,61,0.30)"
                          : "rgba(61,155,107,0.22)";
              return <circle key={e.id} className="heat-blob" cx={p[0]} cy={p[1]} r={10+e.sev*6} fill={color} />;
            })}
          </g>
        )}
        <g>
          {events.map(e => {
            const p = proj(e.lon, e.lat);
            if (!p) return null;
            const sevClass = `sev-${e.tier}`;
            const isLive = (Date.now() - e.ts) < 1000*60*60;
            const r = 2 + e.sev * 0.45;
            return (
              <g key={e.id} className={`evt-marker ${sevClass}`} data-live={isLive}
                 transform={`translate(${p[0]},${p[1]})`}
                 onClick={(ev)=>{ ev.stopPropagation(); onEventClick && onEventClick(e); }}>
                <circle className="pulse" r={3} />
                <circle className="core" r={r} />
                {activeEvent === e.id && <circle className="core" r={r+3} fill="none" stroke="var(--amber)" strokeWidth="1" />}
              </g>
            );
          })}
        </g>
      </svg>
      <div className="map-chrome">
        <div className="map-corner tl">
          <div>ORTHOGRAPHIC · WGS84</div>
          <div style={{color:"var(--ink-0)", marginTop:4}}>MAP · GLOBE</div>
        </div>
        <div className="map-corner tr map-coords">
          <div>CAMERA</div>
          <div><b>λ {rot[0].toFixed(1)}°</b></div>
          <div><b>φ {(-rot[1]).toFixed(1)}°</b></div>
        </div>
        <div className="map-corner bl">
          <div>ZOOM · {zoom.toFixed(2)}×</div>
        </div>
      </div>
    </div>
  );
}

// Mini static flat map for region pages — zoomed to a country centroid
function MiniMap({ iso, events }) {
  const ref = useRef(null);
  const { w, h } = useSize(ref);
  const countries = useWorldData();
  const W = Math.max(1, w), H = Math.max(1, h);

  const target = countries?.find(c => c.id === iso);
  const bounds = useMemo(() => {
    if (!target) return null;
    let minX= Infinity, maxX=-Infinity, minY=Infinity, maxY=-Infinity;
    for (const poly of target.polys) for (const ring of poly) for (const [lon,lat] of ring) {
      if (lon<minX) minX=lon; if (lon>maxX) maxX=lon;
      if (lat<minY) minY=lat; if (lat>maxY) maxY=lat;
    }
    return { minX, maxX, minY, maxY };
  }, [target]);

  const proj = useCallback((lon, lat) => {
    if (!bounds) return [0,0];
    const pad = 0.15;
    const bw = (bounds.maxX - bounds.minX) * (1 + pad*2);
    const bh = (bounds.maxY - bounds.minY) * (1 + pad*2);
    const cx = (bounds.minX + bounds.maxX) / 2;
    const cy = (bounds.minY + bounds.maxY) / 2;
    const aspect = W / Math.max(1,H);
    const bAspect = bw / bh;
    let sx, sy;
    if (aspect > bAspect) { sy = H / bh; sx = sy; }
    else { sx = W / bw; sy = sx; }
    const x = W/2 + (lon - cx) * sx;
    const y = H/2 - (lat - cy) * sy;
    return [x, y];
  }, [bounds, W, H]);

  const countryPaths = useMemo(() => {
    if (!countries) return [];
    return countries.map((c,i) => ({
      id: c.id,
      uid: (c.id != null ? String(c.id) : "c") + "-" + i,
      d: ringsToPath([].concat(...c.polys), proj),
    }));
  }, [countries, proj]);

  const isoEvents = events.filter(e => e.iso === iso);

  return (
    <div className="map-stage" ref={ref}>
      <svg className="map-svg" width={W} height={H} style={{cursor:"default"}}>
        <g>
          {countryPaths.map(c => (
            <path key={c.uid} className="map-country" d={c.d}
              style={{
                fill: c.id === iso ? "var(--bg-3)" : "var(--bg-1)",
                stroke: c.id === iso ? "var(--amber)" : "var(--line)",
                strokeWidth: c.id === iso ? 1.2 : 0.5
              }} />
          ))}
        </g>
        <g>
          {isoEvents.map(e => {
            const [x,y] = proj(e.lon, e.lat);
            return (
              <g key={e.id} className={`evt-marker sev-${e.tier}`} data-live="true" transform={`translate(${x},${y})`}>
                <circle className="pulse" r={3} />
                <circle className="core" r={3 + e.sev*0.4} />
              </g>
            );
          })}
        </g>
      </svg>
    </div>
  );
}

window.MAPR_MAP = { FlatMap, GlobeMap, MiniMap };
