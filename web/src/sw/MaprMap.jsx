/* MaprMap — a severity CHOROPLETH on a real MapLibre GL basemap (via mapcn).
   Each country is filled and shaded by its worst severity tier (computed from
   the events it contains); hovering a country pops it out — brighter fill, an
   ink outline, and a tooltip. Works on flat (mercator) and globe. The country
   geometry is the world-atlas TopoJSON joined to events by ISO code. */
import React, { useState, useEffect, useRef } from "react";
import maplibregl from "maplibre-gl";
import * as topojson from "topojson-client";
import { Map } from "./map/mapcn";
import { MAPR } from "./data.js";

const projFor = (mode) => (mode === "globe" ? { type: "globe" } : { type: "mercator" });
const TIER_ORDER = { green: 0, amber: 1, red: 2, black: 3 };

// ISO 3166-1 alpha-2 -> numeric-3 (matches world-atlas feature ids). Covers the
// corpus countries plus the common set, so expanding the data still colours in.
const ISO_NUM = {
  SD: "729", LB: "422", UA: "804", YE: "887", NL: "528", NG: "566", IR: "364", HT: "332",
  BF: "854", PH: "608", AF: "004", RU: "643", KE: "404", TW: "158", CD: "180", BD: "050",
  IN: "356", US: "840", DE: "276", ML: "466", SG: "702", EG: "818", ID: "360", TD: "148",
  AR: "032", SO: "706", ER: "232", VE: "862", FI: "246", GN: "324", MZ: "508", CO: "170",
  MW: "454", IL: "376", SY: "760", FR: "250", GB: "826", ES: "724", IT: "380", PL: "616",
  TR: "792", SA: "682", IQ: "368", PK: "586", CN: "156", JP: "392", KR: "410", KP: "408",
  MX: "484", BR: "076", CA: "124", AU: "036", ZA: "710", ET: "231", TZ: "834", UG: "800",
  RW: "646", MM: "104", TH: "764", VN: "704", LY: "434", DZ: "012", MA: "504", TN: "788",
  GR: "300", RO: "642", SE: "752", NO: "578", PT: "620", IE: "372", NE: "562", CM: "120",
  CF: "140", SS: "728", AO: "024", CL: "152", PE: "604", BO: "068", EC: "218", JO: "400",
  LK: "144", NP: "524", KH: "116", LA: "418", AZ: "031", AM: "051", GE: "268", KZ: "398",
};
const NUM_ISO = Object.fromEntries(Object.entries(ISO_NUM).map(([k, v]) => [v, k]));

// unwrap ring longitudes so a polygon that crosses the antimeridian (Russia,
// Fiji, …) stays continuous instead of smearing a fill band across the map
function unwrapRing(ring) {
  for (let i = 1; i < ring.length; i++) {
    const d = ring[i][0] - ring[i - 1][0];
    if (d > 180) ring[i][0] -= 360;
    else if (d < -180) ring[i][0] += 360;
  }
}
function fixAntimeridian(geom) {
  if (!geom) return;
  if (geom.type === "Polygon") geom.coordinates.forEach(unwrapRing);
  else if (geom.type === "MultiPolygon") geom.coordinates.forEach((p) => p.forEach(unwrapRing));
}

let _worldPromise = null;
function loadWorld() {
  if (_worldPromise) return _worldPromise;
  // Vendored locally (web/public/geo) — no third-party CDN, so a self-hosted /
  // air-gapped install stays sovereign and the choropleth never depends on
  // egress to jsDelivr.
  _worldPromise = fetch("/geo/countries-110m.json")
    .then((r) => r.json())
    .then((topo) => {
      const fc = topojson.feature(topo, topo.objects.countries);
      fc.features.forEach((f) => { f.id = f.id == null ? "0" : String(f.id); fixAntimeridian(f.geometry); });
      return fc;
    });
  return _worldPromise;
}

// resolve a CSS custom property (incl. oklch, which MapLibre can't parse) to an
// rgb() string by painting it on a 1px canvas and reading back the sRGB pixel.
function resolveColor(varName, fallback) {
  try {
    const raw = getComputedStyle(document.documentElement).getPropertyValue(varName).trim();
    if (!raw) return fallback;
    const cv = document.createElement("canvas");
    cv.width = cv.height = 1;
    const ctx = cv.getContext("2d");
    ctx.fillStyle = raw;
    ctx.fillRect(0, 0, 1, 1);
    const d = ctx.getImageData(0, 0, 1, 1).data;
    return `rgb(${d[0]}, ${d[1]}, ${d[2]})`;
  } catch (e) { return fallback; }
}

// derive a tier from a continuous severity index (matches the MAPR.TIERS bands)
function tierForScore(s) {
  if (s >= 8.5) return "black";
  if (s >= 6.5) return "red";
  if (s >= 4) return "amber";
  return "green";
}

// Per-country severity as a BLENDED index: leans on the worst event (0.55),
// tempered by the country's mean (0.45), plus a log-scaled volume nudge (up to
// +1.2) so a busy hotspot outranks a country with one stray headline. A single
// outlier no longer paints the whole country black; the palette spreads with
// real contrast on dense, live data.
function severityByCountry(events, threshold) {
  const agg = {};
  for (const e of events) {
    if (threshold != null && e.ageMin < threshold) continue;
    const num = ISO_NUM[e.iso2];
    if (!num) continue;
    const a = agg[num] || { sum: 0, max: 0, count: 0, name: e.country };
    a.sum += e.score;
    if (e.score > a.max) a.max = e.score;
    a.count += 1;
    a.name = e.country;
    agg[num] = a;
  }
  const out = {};
  for (const num in agg) {
    const a = agg[num];
    const base = 0.55 * a.max + 0.45 * (a.sum / a.count);
    const vol = Math.min(1, Math.log2(a.count + 1) / 3.585); // saturates ~11 events
    const idx = Math.min(10, base + vol * 1.2);
    out[num] = { score: idx, tier: tierForScore(idx), count: a.count, name: a.name };
  }
  return out;
}
// wider, more expressive shade across the active range (~2.5–9.5)
const opacityFor = (score) => 0.26 + 0.5 * Math.min(1, Math.max(0, (score - 2.5) / 7));

export function MaprMap({ theme, mode, events, focus, onEventClick, dimmed, timeThreshold }) {
  const [map, setMap] = useState(null);
  const [world, setWorld] = useState(null);
  const eventsRef = useRef(events);
  const threshRef = useRef(timeThreshold);
  const sevRef = useRef({});
  const hoverIdRef = useRef(null);
  const tipRef = useRef(null);
  eventsRef.current = events;
  threshRef.current = timeThreshold;

  useEffect(() => {
    loadWorld().then(setWorld).catch((e) => console.error("[mapr] country geometry failed to load", e));
  }, []);

  // add the choropleth source + layers + interactions (re-add after theme change)
  useEffect(() => {
    if (!map || !world) return;

    const refreshStates = () => {
      if (!map.getSource("countries")) return;
      const sev = severityByCountry(eventsRef.current, threshRef.current);
      sevRef.current = sev;
      for (const f of world.features) {
        const s = sev[f.id];
        map.setFeatureState({ source: "countries", id: f.id },
          s ? { tier: s.tier, op: opacityFor(s.score) } : { tier: "none", op: 0 });
      }
    };

    const addLayers = () => {
      if (map.getLayer("country-fill")) return;
      const C = {
        black: resolveColor("--t-black", "#7a1f1f"),
        red: resolveColor("--t-red", "#c43d2e"),
        amber: resolveColor("--t-amber", "#d8a23a"),
        green: resolveColor("--t-green", "#2f9e5b"),
        none: resolveColor("--ink-faint", "#9a9a9a"),
        outline: resolveColor("--ink", "#222222"),
      };
      if (!map.getSource("countries")) map.addSource("countries", { type: "geojson", data: world });
      const firstSymbol = (map.getStyle().layers || []).find((l) => l.type === "symbol")?.id;
      map.addLayer({
        id: "country-fill",
        type: "fill",
        source: "countries",
        paint: {
          "fill-color": ["match", ["coalesce", ["feature-state", "tier"], "none"],
            "black", C.black, "red", C.red, "amber", C.amber, "green", C.green, C.none],
          "fill-opacity": ["min", 1, ["+",
            ["coalesce", ["feature-state", "op"], 0],
            ["case", ["boolean", ["feature-state", "hover"], false], 0.32, 0]]],
          "fill-opacity-transition": { duration: 200 },
          "fill-antialias": true,
        },
      }, firstSymbol);
      map.addLayer({
        id: "country-line",
        type: "line",
        source: "countries",
        paint: {
          "line-color": ["case", ["boolean", ["feature-state", "hover"], false], C.outline, "rgba(0,0,0,0)"],
          "line-width": ["case", ["boolean", ["feature-state", "hover"], false], 2, 0],
          "line-width-transition": { duration: 160 },
        },
      }, firstSymbol);
      refreshStates();
    };

    // add once the style is ready; re-add after a theme change (setStyle wipes
    // custom sources/layers). styledata covers theme changes; idle is a safety
    // net for the initial load race (style can finish before this listener binds).
    const ensure = () => { if (map.isStyleLoaded()) addLayers(); };
    ensure();
    map.on("styledata", ensure);
    map.on("idle", ensure);

    const setHover = (id, on) => { if (id != null) map.setFeatureState({ source: "countries", id }, { hover: on }); };
    const showTip = (lngLat, f) => {
      const s = sevRef.current[f && f.id];
      const name = (f && f.properties && f.properties.name) || "—";
      const label = s ? `${MAPR.TIERS[s.tier].label} · ${s.count} event${s.count === 1 ? "" : "s"}` : "no signals in view";
      const html = `<div class="sw-region-tip"><span class="rt-name">${name}</span><span class="rt-meta">${label}</span></div>`;
      if (!tipRef.current) {
        tipRef.current = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 10, className: "sw-region-popup" });
        tipRef.current.addTo(map);
      }
      tipRef.current.setLngLat(lngLat).setHTML(html);
    };
    const onMove = (e) => {
      const f = e.features && e.features[0];
      const id = f ? f.id : null;
      if (hoverIdRef.current !== id) {
        if (hoverIdRef.current != null) setHover(hoverIdRef.current, false);
        hoverIdRef.current = id;
        if (id != null) setHover(id, true);
        map.getCanvas().style.cursor = id != null && sevRef.current[id] ? "pointer" : "";
      }
      if (f) showTip(e.lngLat, f);
    };
    const onLeave = () => {
      if (hoverIdRef.current != null) setHover(hoverIdRef.current, false);
      hoverIdRef.current = null;
      map.getCanvas().style.cursor = "";
      if (tipRef.current) { tipRef.current.remove(); tipRef.current = null; }
    };
    const onClick = (e) => {
      const f = e.features && e.features[0];
      if (!f || !sevRef.current[f.id]) return;
      const iso2 = NUM_ISO[f.id];
      const evs = eventsRef.current.filter((ev) => ev.iso2 === iso2);
      if (!evs.length) return;
      const top = evs.slice().sort((a, b) => b.score - a.score)[0];
      onEventClick && onEventClick(top);
    };
    map.on("mousemove", "country-fill", onMove);
    map.on("mouseleave", "country-fill", onLeave);
    map.on("click", "country-fill", onClick);

    return () => {
      map.off("styledata", ensure);
      map.off("idle", ensure);
      map.off("mousemove", "country-fill", onMove);
      map.off("mouseleave", "country-fill", onLeave);
      map.off("click", "country-fill", onClick);
      if (tipRef.current) { tipRef.current.remove(); tipRef.current = null; }
    };
  }, [map, world]);

  // re-shade when events / rewind / theme change
  useEffect(() => {
    if (!map || !world || !map.getSource("countries")) return;
    const sev = severityByCountry(events, timeThreshold);
    sevRef.current = sev;
    for (const f of world.features) {
      const s = sev[f.id];
      map.setFeatureState({ source: "countries", id: f.id },
        s ? { tier: s.tier, op: opacityFor(s.score) } : { tier: "none", op: 0 });
    }
  }, [map, world, events, timeThreshold, theme]);

  // flat <-> globe (mapcn only applies projection on initial load)
  useEffect(() => {
    if (!map) return;
    try { map.setProjection(projFor(mode)); } catch (e) { /* style not ready */ }
  }, [map, mode]);

  // fly to the scoped region, kept clear of the dispatch column on the right
  useEffect(() => {
    if (!map || !focus || focus.lng == null) return;
    const wide = window.innerWidth > 860;
    const rightPad = wide ? Math.min(480, window.innerWidth * 0.42) : 0;
    map.flyTo({
      center: [focus.lng, focus.lat],
      zoom: 4.2,
      padding: { top: 70, bottom: 150, left: 40, right: rightPad },
      duration: 1500,
      essential: true,
    });
  }, [map, focus]);

  return (
    <div className="map-wrap" data-dimmed={dimmed ? "1" : "0"}>
      <Map
        ref={setMap}
        className="sw-maplibre"
        theme={theme === "dark" ? "dark" : "light"}
        center={[14, 24]}
        zoom={1.4}
        projection={projFor(mode)}
      />
    </div>
  );
}
