// Regenerate public/world.geo.json from world-atlas TopoJSON using the
// battle-tested topojson-client (correct arc/winding/antimeridian handling),
// dropping Antarctica and embedding { iso (alpha-2), name, cx, cy } per feature
// for labels + region routing. Run: node scripts/gen-basemap.mjs
import { writeFile } from "node:fs/promises";
import * as topojson from "topojson-client";
import { geoCentroid } from "d3-geo";

const ISO2_NAME = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AR: "Argentina", AU: "Australia", AT: "Austria",
  BD: "Bangladesh", BE: "Belgium", BR: "Brazil", BG: "Bulgaria", CA: "Canada", CL: "Chile", CN: "China",
  CO: "Colombia", CD: "DR Congo", HR: "Croatia", CU: "Cuba", CZ: "Czechia", DK: "Denmark", EG: "Egypt",
  ET: "Ethiopia", FI: "Finland", FR: "France", DE: "Germany", GH: "Ghana", GR: "Greece",
  HU: "Hungary", IN: "India", ID: "Indonesia", IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel",
  IT: "Italy", JP: "Japan", JO: "Jordan", KE: "Kenya", KP: "North Korea", KR: "South Korea", LB: "Lebanon",
  LY: "Libya", MY: "Malaysia", MX: "Mexico", MA: "Morocco", MM: "Myanmar", NL: "Netherlands", NZ: "New Zealand",
  NG: "Nigeria", NO: "Norway", PK: "Pakistan", PS: "Palestine", PE: "Peru", PH: "Philippines", PL: "Poland",
  PT: "Portugal", QA: "Qatar", RO: "Romania", RU: "Russia", SA: "Saudi Arabia", RS: "Serbia", SG: "Singapore",
  SI: "Slovenia", SO: "Somalia", ZA: "South Africa", SS: "South Sudan", ES: "Spain", SD: "Sudan", SE: "Sweden",
  CH: "Switzerland", SY: "Syria", TW: "Taiwan", TH: "Thailand", TR: "Türkiye", UA: "Ukraine", AE: "United Arab Emirates",
  GB: "United Kingdom", US: "United States", UZ: "Uzbekistan", VE: "Venezuela", VN: "Vietnam", YE: "Yemen",
};
const norm = (s) => s.toLowerCase().replace(/[.,]/g, "").replace(/\bthe\b/g, "").replace(/\s+/g, " ").trim();
const name2iso = {};
for (const [iso, name] of Object.entries(ISO2_NAME)) name2iso[norm(name)] = iso;
const alias = {
  "united states of america": "US", "dem rep congo": "CD", "democratic republic of congo": "CD", turkey: "TR",
  "south korea": "KR", "north korea": "KP", russia: "RU", "united arab emirates": "AE", "czech republic": "CZ",
  myanmar: "MM", "viet nam": "VN", iran: "IR", syria: "SY", "w sahara": "EH", kosovo: "XK",
};

// ISO 3166-1 numeric → alpha-2. Natural Earth's feature `id` IS the numeric
// code, so this resolves an iso for EVERY country (the name dict above only
// covered ~80 → the rest got iso:null and couldn't hover/tint/click).
const NUM_TO_A2 = {
  "004": "AF", "008": "AL", "012": "DZ", "024": "AO", "028": "AG", "031": "AZ", "032": "AR", "036": "AU",
  "040": "AT", "044": "BS", "048": "BH", "050": "BD", "051": "AM", "052": "BB", "056": "BE", "064": "BT",
  "068": "BO", "070": "BA", "072": "BW", "076": "BR", "084": "BZ", "090": "SB", "096": "BN", "100": "BG",
  "104": "MM", "108": "BI", "112": "BY", "116": "KH", "120": "CM", "124": "CA", "132": "CV", "140": "CF",
  "144": "LK", "148": "TD", "152": "CL", "156": "CN", "158": "TW", "170": "CO", "174": "KM", "178": "CG",
  "180": "CD", "188": "CR", "191": "HR", "192": "CU", "196": "CY", "203": "CZ", "204": "BJ", "208": "DK",
  "212": "DM", "214": "DO", "218": "EC", "222": "SV", "226": "GQ", "231": "ET", "232": "ER", "233": "EE",
  "238": "FK", "242": "FJ", "246": "FI", "250": "FR", "260": "TF", "262": "DJ", "266": "GA", "268": "GE",
  "270": "GM", "275": "PS", "276": "DE", "288": "GH", "300": "GR", "304": "GL", "320": "GT", "324": "GN",
  "328": "GY", "332": "HT", "340": "HN", "348": "HU", "352": "IS", "356": "IN", "360": "ID", "364": "IR",
  "368": "IQ", "372": "IE", "376": "IL", "380": "IT", "384": "CI", "388": "JM", "392": "JP", "398": "KZ",
  "400": "JO", "404": "KE", "408": "KP", "410": "KR", "414": "KW", "417": "KG", "418": "LA", "422": "LB",
  "426": "LS", "428": "LV", "430": "LR", "434": "LY", "440": "LT", "442": "LU", "450": "MG", "454": "MW", "458": "MY",
  "466": "ML", "478": "MR", "484": "MX", "496": "MN", "498": "MD", "499": "ME", "504": "MA", "508": "MZ",
  "512": "OM", "516": "NA", "524": "NP", "528": "NL", "540": "NC", "548": "VU", "554": "NZ", "558": "NI",
  "562": "NE", "566": "NG", "578": "NO", "586": "PK", "591": "PA", "598": "PG", "600": "PY", "604": "PE",
  "608": "PH", "616": "PL", "620": "PT", "624": "GW", "626": "TL", "630": "PR", "634": "QA", "642": "RO",
  "643": "RU", "646": "RW", "682": "SA", "686": "SN", "688": "RS", "694": "SL", "702": "SG", "703": "SK",
  "704": "VN", "705": "SI", "706": "SO", "710": "ZA", "716": "ZW", "724": "ES", "728": "SS", "729": "SD",
  "732": "EH", "740": "SR", "748": "SZ", "752": "SE", "756": "CH", "760": "SY", "762": "TJ", "764": "TH",
  "768": "TG", "780": "TT", "784": "AE", "788": "TN", "792": "TR", "795": "TM", "800": "UG", "804": "UA",
  "807": "MK", "818": "EG", "826": "GB", "834": "TZ", "840": "US", "854": "BF", "858": "UY", "860": "UZ",
  "862": "VE", "876": "WF", "882": "WS", "887": "YE", "894": "ZM",
};

const urls = [
  "https://cdn.jsdelivr.net/npm/world-atlas@2/countries-110m.json",
  "https://unpkg.com/world-atlas@2/countries-110m.json",
];
let topo = null;
for (const u of urls) {
  try { const r = await fetch(u); if (r.ok) { topo = await r.json(); break; } } catch { /* next */ }
}
if (!topo) throw new Error("failed to fetch world-atlas");

// Unwrap antimeridian-crossing rings into continuous longitudes so MapLibre
// renders them wrapped (no horizontal band). Harmless for non-crossing rings.
function unwrapRing(ring) {
  const out = [ring[0].slice()];
  let prev = ring[0][0];
  let offset = 0;
  for (let i = 1; i < ring.length; i++) {
    const lon = ring[i][0];
    const d = lon + offset - prev;
    if (d > 180) offset -= 360;
    else if (d < -180) offset += 360;
    const adj = lon + offset;
    out.push([adj, ring[i][1]]);
    prev = adj;
  }
  return out;
}
function unwrapGeometry(g) {
  if (g.type === "Polygon") return { type: "Polygon", coordinates: g.coordinates.map(unwrapRing) };
  if (g.type === "MultiPolygon") return { type: "MultiPolygon", coordinates: g.coordinates.map((p) => p.map(unwrapRing)) };
  return g;
}

const fc = topojson.feature(topo, topo.objects.countries);
const features = [];
for (const f of fc.features) {
  const name = f.properties?.name || "";
  if (name === "Antarctica") continue; // bottom-edge ring renders as a band; irrelevant for OSINT
  const iso = NUM_TO_A2[String(f.id)] || alias[norm(name)] || name2iso[norm(name)] || null;
  let cx = 0, cy = 0;
  try { const c = geoCentroid(f); if (Number.isFinite(c[0]) && Number.isFinite(c[1])) { cx = c[0]; cy = c[1]; } } catch { /* keep 0,0 */ }
  features.push({ type: "Feature", id: iso || String(f.id), properties: { name, iso, cx, cy }, geometry: unwrapGeometry(f.geometry) });
}
const out = JSON.stringify({ type: "FeatureCollection", features });
await writeFile(new URL("../public/world.geo.json", import.meta.url), out);
console.log(JSON.stringify({ features: features.length, withIso: features.filter((f) => f.properties.iso).length, bytes: out.length }));
