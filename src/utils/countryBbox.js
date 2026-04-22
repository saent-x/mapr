import countriesUrl from '../assets/ne_110m_admin_0_countries.geojson?url';

let bboxPromise = null;

function computeBbox(feature) {
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity;
  let eW = Infinity, eS = Infinity, eE = -Infinity, eN = -Infinity, eCount = 0;
  let wW = Infinity, wS = Infinity, wE = -Infinity, wN = -Infinity, wCount = 0;
  const walk = (coords) => {
    if (!Array.isArray(coords)) return;
    if (typeof coords[0] === 'number') {
      const [lng, lat] = coords;
      if (lng < w) w = lng;
      if (lng > e) e = lng;
      if (lat < s) s = lat;
      if (lat > n) n = lat;
      if (lng >= 0) {
        if (lng < eW) eW = lng;
        if (lng > eE) eE = lng;
        if (lat < eS) eS = lat;
        if (lat > eN) eN = lat;
        eCount++;
      } else {
        if (lng < wW) wW = lng;
        if (lng > wE) wE = lng;
        if (lat < wS) wS = lat;
        if (lat > wN) wN = lat;
        wCount++;
      }
      return;
    }
    for (const c of coords) walk(c);
  };
  walk(feature.geometry?.coordinates);
  if (e - w >= 350 && (eCount > 0 || wCount > 0)) {
    if (eCount >= wCount) return [eW, eS, eE, eN];
    return [wW, wS, wE, wN];
  }
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
