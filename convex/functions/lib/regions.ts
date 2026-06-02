// ISO-3166 alpha-2 → display name. Single source of truth for region labels
// (used by the intent parser, region dossier, etc.). Live data may carry any
// alpha-2 the Rust gazetteer resolves, so this covers the common set; unknown
// codes fall back to the code itself.
export const ISO2_NAME: Record<string, string> = {
  AF: "Afghanistan", AL: "Albania", DZ: "Algeria", AR: "Argentina", AU: "Australia", AT: "Austria",
  BD: "Bangladesh", BE: "Belgium", BR: "Brazil", BG: "Bulgaria", CA: "Canada", CL: "Chile", CN: "China",
  CO: "Colombia", CD: "DR Congo", HR: "Croatia", CU: "Cuba", CZ: "Czechia", DK: "Denmark", EG: "Egypt",
  ET: "Ethiopia", FI: "Finland", FR: "France", DE: "Germany", GH: "Ghana", GR: "Greece", HK: "Hong Kong",
  HU: "Hungary", IN: "India", ID: "Indonesia", IR: "Iran", IQ: "Iraq", IE: "Ireland", IL: "Israel",
  IT: "Italy", JP: "Japan", JO: "Jordan", KE: "Kenya", KP: "North Korea", KR: "South Korea", LB: "Lebanon",
  LY: "Libya", MY: "Malaysia", MX: "Mexico", MA: "Morocco", MM: "Myanmar", NL: "Netherlands", NZ: "New Zealand",
  NG: "Nigeria", NO: "Norway", PK: "Pakistan", PS: "Palestine", PE: "Peru", PH: "Philippines", PL: "Poland",
  PT: "Portugal", QA: "Qatar", RO: "Romania", RU: "Russia", SA: "Saudi Arabia", RS: "Serbia", SG: "Singapore",
  SI: "Slovenia", SO: "Somalia", ZA: "South Africa", SS: "South Sudan", ES: "Spain", SD: "Sudan", SE: "Sweden",
  CH: "Switzerland", SY: "Syria", TW: "Taiwan", TH: "Thailand", TR: "Türkiye", UA: "Ukraine", AE: "UAE",
  GB: "United Kingdom", US: "United States", UZ: "Uzbekistan", VE: "Venezuela", VN: "Vietnam", YE: "Yemen",
};

export function regionName(iso: string): string {
  return ISO2_NAME[iso] || iso || "Unlocated";
}
