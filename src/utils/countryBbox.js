import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';

let bboxPromise = null;
let featurePromise = null;

function computeBbox(feature) {
  if (feature.bbox && feature.bbox.length >= 4) {
    const [w, s, e, n] = feature.bbox;
    return [w, s, e, n];
  }
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(feature.geometry?.coordinates);
  return [w, s, e, n];
}

function resolveIso(feature) {
  const p = feature.properties || {};
  const a2 = p.ISO_A2 && p.ISO_A2 !== '-99' ? p.ISO_A2 : null;
  if (a2) return a2.toUpperCase();
  const a3 = p.ISO_A3 && p.ISO_A3 !== '-99' ? p.ISO_A3 : null;
  if (a3) return a3.toUpperCase();
  return null;
}

function loadCountryBboxes() {
  if (bboxPromise) return bboxPromise;
  bboxPromise = fetch(countriesUrl)
    .then((r) => r.json())
    .then((gj) => {
      const map = new Map();
      for (const f of gj.features || []) {
        const iso = resolveIso(f);
        if (!iso) continue;
        map.set(iso, computeBbox(f));
      }
      return map;
    })
    .catch(() => new Map());
  return bboxPromise;
}

export async function getCountryBbox(iso) {
  if (!iso) return null;
  const map = await loadCountryBboxes();
  return map.get(String(iso).toUpperCase()) || null;
}

function loadCountryFeatures() {
  if (featurePromise) return featurePromise;
  featurePromise = fetch(countriesUrl)
    .then((r) => r.json())
    .then((gj) => {
      const map = new Map();
      for (const f of gj.features || []) {
        const iso = resolveIso(f);
        if (!iso) continue;
        map.set(iso, f);
      }
      return map;
    })
    .catch(() => new Map());
  return featurePromise;
}

export async function getCountryFeature(iso) {
  if (!iso) return null;
  const map = await loadCountryFeatures();
  return map.get(String(iso).toUpperCase()) || null;
}
