/* Seed data for MAPR console */
(function(){
'use strict';

// Realistic-but-fictional event dataset
// lon,lat in decimal degrees. sev: 0-10. tier: green/amber/red/black
const EVENTS = [
  // Earthquakes
  { id: "EVT-1042-A7", lon: 138.25, lat: 36.21, sev: 7.2, tier: "red", cat: "seismic",
    title: "M6.1 earthquake detected offshore Honshu; tsunami advisory issued",
    src: "NHK·Reuters·USGS", lang: "ja", iso: "JPN", ts: Date.now() - 1000*60*17,
    summary: "USGS preliminary magnitude 6.1 at depth 27km, 142km ENE of Sendai. Japan Meteorological Agency issued tsunami advisory for Miyagi and Fukushima prefectures. No immediate reports of damage to reactor facilities." },
  { id: "EVT-1038-K2", lon: 28.98, lat: 41.01, sev: 3.4, tier: "amber", cat: "seismic",
    title: "Minor tremor recorded in Marmara region; no structural alerts",
    src: "AFAD·Hürriyet", lang: "tr", iso: "TUR", ts: Date.now() - 1000*60*82 },

  // Cyber
  { id: "EVT-1051-C3", lon: -77.04, lat: 38.89, sev: 6.8, tier: "red", cat: "cyber",
    title: "Suspected APT intrusion at federal civilian agency; CISA issues Emergency Directive 26-04",
    src: "CISA·Bloomberg·WaPo", lang: "en", iso: "USA", ts: Date.now() - 1000*60*34,
    summary: "CISA issued Emergency Directive 26-04 requiring federal agencies to patch an actively exploited remote code execution vulnerability within 72 hours. Threat actor overlap with UNC4841 observed." },
  { id: "EVT-1047-C9", lon: 4.35, lat: 50.85, sev: 5.1, tier: "amber", cat: "cyber",
    title: "Ransomware disrupts hospital network in Brussels; surgeries rescheduled",
    src: "Le Soir·RTBF", lang: "fr", iso: "BEL", ts: Date.now() - 1000*60*125 },
  { id: "EVT-1062-C4", lon: 103.82, lat: 1.35, sev: 4.6, tier: "amber", cat: "cyber",
    title: "Data broker discloses breach affecting 2.3M Southeast Asian consumers",
    src: "Straits Times·CNA", lang: "en", iso: "SGP", ts: Date.now() - 1000*60*210 },

  // Protests / civil unrest
  { id: "EVT-1055-U1", lon: 2.35, lat: 48.85, sev: 4.2, tier: "amber", cat: "unrest",
    title: "Transport workers' strike enters day 4; Paris Metro at 30% capacity",
    src: "Le Monde·AFP", lang: "fr", iso: "FRA", ts: Date.now() - 1000*60*48 },
  { id: "EVT-1061-U6", lon: -58.38, lat: -34.60, sev: 5.9, tier: "red", cat: "unrest",
    title: "Mass demonstrations in Buenos Aires over proposed subsidy cuts",
    src: "Clarín·La Nación·BBC", lang: "es", iso: "ARG", ts: Date.now() - 1000*60*95 },
  { id: "EVT-1066-U4", lon: 77.21, lat: 28.61, sev: 6.4, tier: "red", cat: "unrest",
    title: "Clashes reported at Delhi university; internet throttled in 3 districts",
    src: "The Hindu·NDTV·Reuters", lang: "en", iso: "IND", ts: Date.now() - 1000*60*62 },
  { id: "EVT-1071-U9", lon: 31.23, lat: 30.05, sev: 5.3, tier: "amber", cat: "unrest",
    title: "Bread price protests spread to three governorates in Egypt",
    src: "Al Masry Al Youm·MEE", lang: "ar", iso: "EGY", ts: Date.now() - 1000*60*175 },

  // Conflict
  { id: "EVT-1033-M2", lon: 30.52, lat: 50.45, sev: 8.2, tier: "red", cat: "conflict",
    title: "Kyiv reports large-scale drone interception overnight; infrastructure strikes in Kharkiv",
    src: "Kyiv Independent·Reuters", lang: "uk", iso: "UKR", ts: Date.now() - 1000*60*8 },
  { id: "EVT-1029-M7", lon: 35.21, lat: 31.77, sev: 7.9, tier: "red", cat: "conflict",
    title: "Escalation along northern frontier; UN calls emergency Security Council session",
    src: "Haaretz·Al Jazeera·Reuters", lang: "en", iso: "ISR", ts: Date.now() - 1000*60*23 },
  { id: "EVT-1075-M3", lon: 33.83, lat: 9.59, sev: 8.6, tier: "black", cat: "conflict",
    title: "Humanitarian corridor disrupted in South Sudan; WFP pulls non-essential staff",
    src: "OCHA·AP", lang: "en", iso: "SSD", ts: Date.now() - 1000*60*260 },

  // Weather / climate
  { id: "EVT-1044-W5", lon: -95.36, lat: 29.76, sev: 5.8, tier: "amber", cat: "weather",
    title: "Tropical storm intensifying in Gulf; Texas coast under watch",
    src: "NHC·NOAA·Houston Chronicle", lang: "en", iso: "USA", ts: Date.now() - 1000*60*55 },
  { id: "EVT-1058-W2", lon: 121.47, lat: 31.23, sev: 6.5, tier: "red", cat: "weather",
    title: "Record rainfall triggers flash floods in Yangtze delta; 40k displaced",
    src: "Xinhua·SCMP", lang: "zh", iso: "CHN", ts: Date.now() - 1000*60*140 },
  { id: "EVT-1068-W8", lon: 151.21, lat: -33.87, sev: 3.9, tier: "amber", cat: "weather",
    title: "Bushfire warning lifted for NSW central coast; air quality still poor",
    src: "ABC News·Sydney Morning Herald", lang: "en", iso: "AUS", ts: Date.now() - 1000*60*310 },

  // Economic / markets
  { id: "EVT-1052-E1", lon: -0.13, lat: 51.51, sev: 4.7, tier: "amber", cat: "economic",
    title: "Pound tumbles 1.4% on unexpected inflation print; gilts selloff",
    src: "FT·Reuters·Bloomberg", lang: "en", iso: "GBR", ts: Date.now() - 1000*60*42 },
  { id: "EVT-1067-E5", lon: 116.40, lat: 39.90, sev: 5.2, tier: "amber", cat: "economic",
    title: "PBoC unexpectedly trims 7-day reverse repo rate; yuan weakens",
    src: "Caixin·Bloomberg", lang: "zh", iso: "CHN", ts: Date.now() - 1000*60*220 },

  // Public health
  { id: "EVT-1073-H3", lon: 23.72, lat: -3.48, sev: 6.9, tier: "red", cat: "health",
    title: "Suspected viral hemorrhagic fever cluster in Equateur; WHO dispatches team",
    src: "WHO·MSF", lang: "fr", iso: "COD", ts: Date.now() - 1000*60*188 },

  // Maritime
  { id: "EVT-1076-S2", lon: 43.14, lat: 12.80, sev: 5.6, tier: "amber", cat: "maritime",
    title: "Commercial vessel reports drone incident in Bab-el-Mandeb; no casualties",
    src: "UKMTO·Lloyd's List", lang: "en", iso: "YEM", ts: Date.now() - 1000*60*72 },
  { id: "EVT-1078-S4", lon: 114.16, lat: 22.28, sev: 2.8, tier: "green", cat: "maritime",
    title: "Minor collision in Victoria Harbour; both vessels under own power",
    src: "SCMP", lang: "en", iso: "HKG", ts: Date.now() - 1000*60*350 },

  // Space / tech
  { id: "EVT-1082-T1", lon: -80.60, lat: 28.56, sev: 3.1, tier: "green", cat: "tech",
    title: "Scheduled orbital launch scrubbed due to upper-level winds",
    src: "SpaceFlightNow·NASA", lang: "en", iso: "USA", ts: Date.now() - 1000*60*95 },

  // Additional amber/green filler for map density
  { id: "EVT-1085-U2", lon: -99.13, lat: 19.43, sev: 4.1, tier: "amber", cat: "unrest",
    title: "Teachers union rallies in Mexico City demanding wage review",
    src: "El Universal", lang: "es", iso: "MEX", ts: Date.now() - 1000*60*130 },
  { id: "EVT-1089-C2", lon: 13.40, lat: 52.52, sev: 3.7, tier: "amber", cat: "cyber",
    title: "German federal office confirms phishing campaign targeting legislators",
    src: "Der Spiegel·BSI", lang: "de", iso: "DEU", ts: Date.now() - 1000*60*165 },
  { id: "EVT-1092-W3", lon: 18.42, lat: -33.92, sev: 3.3, tier: "green", cat: "weather",
    title: "Cape Town water reserves climb to 74% after late-season rains",
    src: "News24", lang: "en", iso: "ZAF", ts: Date.now() - 1000*60*420 },
  { id: "EVT-1095-M1", lon: 69.24, lat: 41.31, sev: 4.4, tier: "amber", cat: "conflict",
    title: "Border incident reported between Tajik and Kyrgyz patrols; talks underway",
    src: "RFE/RL·Eurasianet", lang: "ru", iso: "UZB", ts: Date.now() - 1000*60*205 },
  { id: "EVT-1098-H1", lon: -46.63, lat: -23.55, sev: 3.8, tier: "amber", cat: "health",
    title: "Dengue case surge prompts São Paulo emergency response level 2",
    src: "Folha·G1", lang: "pt", iso: "BRA", ts: Date.now() - 1000*60*275 },
  { id: "EVT-1101-C5", lon: 37.62, lat: 55.75, sev: 5.4, tier: "amber", cat: "cyber",
    title: "Outages reported across multiple Russian banking apps for 4h",
    src: "Kommersant·TASS", lang: "ru", iso: "RUS", ts: Date.now() - 1000*60*155 },
  { id: "EVT-1104-E2", lon: 126.98, lat: 37.57, sev: 3.5, tier: "green", cat: "economic",
    title: "KOSPI closes flat after chip rotation; won steady vs dollar",
    src: "Yonhap·Reuters", lang: "ko", iso: "KOR", ts: Date.now() - 1000*60*380 },
  { id: "EVT-1107-W1", lon: 14.50, lat: 46.05, sev: 2.4, tier: "green", cat: "weather",
    title: "Alpine avalanche warning lifted across Slovenian Karawanks",
    src: "Delo·ARSO", lang: "sl", iso: "SVN", ts: Date.now() - 1000*60*460 },
  { id: "EVT-1110-U7", lon: -70.65, lat: -33.46, sev: 4.8, tier: "amber", cat: "unrest",
    title: "Student march in Santiago over public transport fares; metro partial close",
    src: "La Tercera·BioBioChile", lang: "es", iso: "CHL", ts: Date.now() - 1000*60*200 },
  { id: "EVT-1115-T2", lon: 139.77, lat: 35.68, sev: 2.9, tier: "green", cat: "tech",
    title: "Major cloud provider reports partial APAC region degradation; resolved",
    src: "Nikkei·Reuters", lang: "ja", iso: "JPN", ts: Date.now() - 1000*60*330 },
  { id: "EVT-1118-M4", lon: 44.36, lat: 33.31, sev: 6.1, tier: "red", cat: "conflict",
    title: "Rocket attack reported near Green Zone perimeter; no casualties confirmed",
    src: "Reuters·AFP", lang: "ar", iso: "IRQ", ts: Date.now() - 1000*60*115 },
  { id: "EVT-1122-S1", lon: 103.85, lat: 1.29, sev: 3.2, tier: "green", cat: "maritime",
    title: "Singapore Strait traffic advisory lifted after earlier navigational hazard",
    src: "MPA·Lloyd's List", lang: "en", iso: "SGP", ts: Date.now() - 1000*60*290 },
  { id: "EVT-1125-U3", lon: 12.50, lat: 41.90, sev: 3.6, tier: "amber", cat: "unrest",
    title: "Anti-austerity march in central Rome; police estimate 12,000 attendees",
    src: "La Repubblica·ANSA", lang: "it", iso: "ITA", ts: Date.now() - 1000*60*225 },
  { id: "EVT-1128-C6", lon: -43.17, lat: -22.91, sev: 4.9, tier: "amber", cat: "cyber",
    title: "Municipal services offline in Rio after suspected cyber incident",
    src: "O Globo", lang: "pt", iso: "BRA", ts: Date.now() - 1000*60*185 },
  { id: "EVT-1131-W4", lon: 73.85, lat: 18.52, sev: 4.3, tier: "amber", cat: "weather",
    title: "Pre-monsoon heatwave advisory issued across Maharashtra",
    src: "IMD·Times of India", lang: "en", iso: "IND", ts: Date.now() - 1000*60*400 },
  { id: "EVT-1134-E3", lon: 8.54, lat: 47.37, sev: 3.4, tier: "green", cat: "economic",
    title: "Swiss franc retreats from 6-month high on SNB commentary",
    src: "NZZ·Reuters", lang: "de", iso: "CHE", ts: Date.now() - 1000*60*245 },
  { id: "EVT-1137-M5", lon: 38.77, lat: 9.02, sev: 6.7, tier: "red", cat: "conflict",
    title: "Armed clashes reported in Amhara region; federal response mobilizing",
    src: "Addis Standard·Reuters", lang: "am", iso: "ETH", ts: Date.now() - 1000*60*305 },
  { id: "EVT-1140-H2", lon: 90.40, lat: 23.81, sev: 4.6, tier: "amber", cat: "health",
    title: "Cholera outbreak spreads to two additional districts in Bangladesh",
    src: "Daily Star·WHO", lang: "bn", iso: "BGD", ts: Date.now() - 1000*60*355 },
];

// Regions — for watchlist / region page
const REGIONS = [
  { iso: "UKR", name: "Ukraine", avg: 7.4, count: 34, trend: +12 },
  { iso: "ISR", name: "Israel & Levant", avg: 7.1, count: 28, trend: +4 },
  { iso: "USA", name: "United States", avg: 4.8, count: 62, trend: +2 },
  { iso: "CHN", name: "China", avg: 5.3, count: 41, trend: -3 },
  { iso: "IND", name: "India", avg: 5.6, count: 38, trend: +7 },
  { iso: "TUR", name: "Türkiye", avg: 4.2, count: 19, trend: -1 },
  { iso: "RUS", name: "Russia", avg: 6.2, count: 44, trend: +1 },
  { iso: "BRA", name: "Brazil", avg: 4.4, count: 23, trend: +5 },
  { iso: "JPN", name: "Japan", avg: 3.9, count: 16, trend: 0 },
  { iso: "FRA", name: "France", avg: 3.8, count: 22, trend: +3 },
  { iso: "EGY", name: "Egypt", avg: 4.9, count: 14, trend: +2 },
  { iso: "ETH", name: "Ethiopia", avg: 6.5, count: 17, trend: +6 },
];

// Anomalies — sparklines
function sparkline(seed, len=24){
  const out = [];
  let v = 40 + (seed%30);
  for (let i=0;i<len;i++){
    const s = Math.sin((seed+i)*0.7) * 8 + Math.cos((seed+i)*1.3) * 5;
    v = Math.max(5, Math.min(95, v + s + (Math.random()-0.5)*4));
    out.push(v);
  }
  return out;
}
const ANOMALIES = [
  { label: "Cyber mentions · CIS region", delta: "+214%", data: sparkline(3), dir: "up" },
  { label: "Protest keyword · LATAM", delta: "+87%", data: sparkline(7), dir: "up" },
  { label: "Maritime incidents · Red Sea", delta: "+41%", data: sparkline(11), dir: "up" },
  { label: "Seismic chatter · JP coast", delta: "+33%", data: sparkline(17), dir: "up" },
  { label: "Coverage gap · Central Africa", delta: "-62%", data: sparkline(23).map(x=>100-x), dir: "down" },
];

// Narratives — clustered stories
const NARRATIVES = [
  { id: "NAR-A31", title: "Escalation cluster · Eastern Mediterranean",
    sub: "18 sources · 42 articles · 3h window", count: 42 },
  { id: "NAR-A29", title: "Coordinated ransomware targeting municipal services",
    sub: "9 sources · 14 articles · 12h window", count: 14 },
  { id: "NAR-A27", title: "Subsidy cuts driving civil unrest · Southern Cone",
    sub: "22 sources · 31 articles · 6h window", count: 31 },
  { id: "NAR-A24", title: "Pre-monsoon extreme weather · South Asia",
    sub: "11 sources · 17 articles · 24h window", count: 17 },
];

// Entities — force graph (people / orgs / locations)
const ENTITIES = [
  { id: "E1", label: "Black Basta", type: "org",     x: 0.22, y: 0.35, size: 14, conn: 7 },
  { id: "E2", label: "CISA",        type: "org",     x: 0.38, y: 0.42, size: 12, conn: 9 },
  { id: "E3", label: "UNC4841",     type: "org",     x: 0.18, y: 0.52, size: 10, conn: 5 },
  { id: "E4", label: "Washington DC", type: "loc",   x: 0.42, y: 0.55, size: 9,  conn: 8 },
  { id: "E5", label: "Brussels",    type: "loc",     x: 0.28, y: 0.62, size: 8,  conn: 4 },
  { id: "E6", label: "J. Reinhardt", type: "person", x: 0.35, y: 0.25, size: 7,  conn: 3 },
  { id: "E7", label: "NHS Trust",   type: "org",     x: 0.50, y: 0.30, size: 9,  conn: 5 },
  { id: "E8", label: "APT29",       type: "org",     x: 0.12, y: 0.28, size: 11, conn: 6 },
  { id: "E9", label: "Kyiv",        type: "loc",     x: 0.58, y: 0.18, size: 10, conn: 7 },
  { id: "E10", label: "GUR",        type: "org",     x: 0.65, y: 0.30, size: 9,  conn: 6 },
  { id: "E11", label: "Gen. Budanov", type: "person", x: 0.72, y: 0.42, size: 8, conn: 4 },
  { id: "E12", label: "Bab-el-Mandeb", type: "loc",  x: 0.55, y: 0.72, size: 8,  conn: 5 },
  { id: "E13", label: "UKMTO",      type: "org",     x: 0.42, y: 0.78, size: 7,  conn: 3 },
  { id: "E14", label: "Ansar Allah", type: "org",    x: 0.68, y: 0.78, size: 10, conn: 5 },
  { id: "E15", label: "Tehran",     type: "loc",     x: 0.80, y: 0.68, size: 10, conn: 7 },
  { id: "E16", label: "IRGC-QF",    type: "org",     x: 0.88, y: 0.58, size: 11, conn: 7 },
  { id: "E17", label: "M. Ghaani",  type: "person",  x: 0.78, y: 0.52, size: 8,  conn: 4 },
  { id: "E18", label: "Hezbollah",  type: "org",     x: 0.82, y: 0.78, size: 11, conn: 6 },
  { id: "E19", label: "Beirut",     type: "loc",     x: 0.92, y: 0.70, size: 8,  conn: 3 },
  { id: "E20", label: "N. Nasrallah", type: "person", x: 0.85, y: 0.85, size: 7, conn: 2 },
  { id: "E21", label: "Reuters",    type: "org",     x: 0.10, y: 0.10, size: 7,  conn: 8 },
  { id: "E22", label: "Al Jazeera", type: "org",     x: 0.05, y: 0.68, size: 8,  conn: 6 },
];
const ENTITY_EDGES = [
  ["E1","E2"],["E1","E3"],["E1","E4"],["E2","E4"],["E2","E6"],["E3","E8"],
  ["E3","E4"],["E5","E7"],["E5","E2"],["E8","E6"],["E8","E9"],["E9","E10"],
  ["E10","E11"],["E12","E13"],["E12","E14"],["E14","E15"],["E14","E18"],
  ["E15","E16"],["E16","E17"],["E16","E18"],["E18","E19"],["E18","E20"],
  ["E15","E18"],["E15","E17"],["E21","E4"],["E21","E9"],["E22","E14"],
  ["E22","E19"],["E9","E21"],["E4","E21"],["E11","E9"],["E16","E15"],
  ["E7","E4"],["E6","E4"],
];

// Sources — for admin
const SRC_LANGS = ["en","fr","es","de","ja","zh","ar","ru","pt","it","tr","uk","ko","bn","am","he"];
const SRC_PROVIDERS = [
  ["Reuters World", "reuters.com", "en", "wire"],
  ["Agence France-Presse", "afp.com", "fr", "wire"],
  ["Associated Press", "ap.org", "en", "wire"],
  ["Xinhua", "xinhuanet.com", "zh", "wire"],
  ["TASS", "tass.ru", "ru", "wire"],
  ["Bloomberg", "bloomberg.com", "en", "news"],
  ["Financial Times", "ft.com", "en", "news"],
  ["Le Monde", "lemonde.fr", "fr", "news"],
  ["Der Spiegel", "spiegel.de", "de", "news"],
  ["NHK World", "nhk.or.jp", "ja", "news"],
  ["Al Jazeera", "aljazeera.com", "ar", "news"],
  ["BBC Monitoring", "bbc.co.uk", "en", "news"],
  ["SCMP", "scmp.com", "en", "news"],
  ["Haaretz", "haaretz.com", "he", "news"],
  ["Kyiv Independent", "kyivindependent.com", "en", "news"],
  ["Le Soir", "lesoir.be", "fr", "news"],
  ["El País", "elpais.com", "es", "news"],
  ["Clarín", "clarin.com", "es", "news"],
  ["O Globo", "oglobo.globo.com", "pt", "news"],
  ["Folha de S.Paulo", "folha.uol.com.br", "pt", "news"],
  ["La Repubblica", "repubblica.it", "it", "news"],
  ["Hürriyet", "hurriyet.com.tr", "tr", "news"],
  ["Kommersant", "kommersant.ru", "ru", "news"],
  ["The Hindu", "thehindu.com", "en", "news"],
  ["NDTV", "ndtv.com", "en", "news"],
  ["Nikkei", "nikkei.com", "ja", "news"],
  ["Yonhap", "yna.co.kr", "ko", "news"],
  ["Daily Star BD", "thedailystar.net", "bn", "news"],
  ["Addis Standard", "addisstandard.com", "am", "news"],
  ["CISA", "cisa.gov", "en", "gov"],
  ["USGS Hazards", "earthquake.usgs.gov", "en", "gov"],
  ["NHC/NOAA", "nhc.noaa.gov", "en", "gov"],
  ["WHO Alerts", "who.int", "en", "gov"],
  ["UKMTO", "ukmto.org", "en", "gov"],
  ["OCHA ReliefWeb", "reliefweb.int", "en", "gov"],
  ["IMD India", "imd.gov.in", "en", "gov"],
  ["AFAD", "afad.gov.tr", "tr", "gov"],
  ["ARSO", "arso.gov.si", "sl", "gov"],
];

function mkSources(){
  // Expand with synthetic ones to hit ~60 rows
  const base = SRC_PROVIDERS.slice();
  const extra = [
    ["Caixin", "caixin.com", "zh", "news"],
    ["RFE/RL", "rferl.org", "en", "news"],
    ["Eurasianet", "eurasianet.org", "en", "news"],
    ["Straits Times", "straitstimes.com", "en", "news"],
    ["Times of India", "timesofindia.com", "en", "news"],
    ["El Universal", "eluniversal.com.mx", "es", "news"],
    ["La Nación AR", "lanacion.com.ar", "es", "news"],
    ["Al Masry Al Youm", "almasryalyoum.com", "ar", "news"],
    ["Middle East Eye", "middleeasteye.net", "en", "news"],
    ["NZZ", "nzz.ch", "de", "news"],
    ["Delo SI", "delo.si", "sl", "news"],
    ["ANSA", "ansa.it", "it", "news"],
    ["ABC News AU", "abc.net.au", "en", "news"],
    ["News24", "news24.com", "en", "news"],
    ["BioBioChile", "biobiochile.cl", "es", "news"],
    ["La Tercera", "latercera.com", "es", "news"],
    ["G1 Globo", "g1.globo.com", "pt", "news"],
    ["MSF Alerts", "msf.org", "en", "ngo"],
    ["Lloyd's List", "lloydslist.com", "en", "wire"],
    ["SpaceFlightNow", "spaceflightnow.com", "en", "news"],
  ];
  return base.concat(extra).map((r, i) => {
    const [name,url,lang,kind] = r;
    // Deterministic pseudo-random fields
    const h = (name.charCodeAt(0)*7 + i*13) % 100;
    const statusSeed = (i*17) % 10;
    let status = "ok", latency = 120 + (h%400);
    if (statusSeed === 9) { status = "err"; latency = 9999; }
    else if (statusSeed === 8 || statusSeed === 7) { status = "warn"; latency = 800 + (h%400); }
    const rate = 3 + (h % 50);
    const uptime = status === "err" ? 92 + (h%6) : status === "warn" ? 97 + (h%2) : 99.2 + (h%7)/10;
    const uptime24 = [];
    for (let j=0;j<24;j++){
      const rnd = (i*31 + j*17) % 100;
      let s = "";
      if (status === "err" && (j === 22 || j === 23)) s = "e";
      else if (rnd > 96) s = "w";
      else if (rnd > 98) s = "e";
      uptime24.push(s);
    }
    return { id: `SRC-${String(i+1).padStart(3,"0")}`, name, url, lang, kind, status, latency, rate, uptime: +uptime.toFixed(2), uptime24 };
  });
}

// Articles for region page — built from events + synthetic
function articlesFor(iso) {
  const base = EVENTS.filter(e => e.iso === iso);
  // generate a few more
  const extras = [
    { id: `${iso}-A1`, title: "Ministry reaffirms position in televised briefing", sev: 3.2, tier: "amber", src: "AP", lang: "en", ts: Date.now() - 1000*60*290 },
    { id: `${iso}-A2`, title: "Opposition coalition issues joint statement", sev: 2.8, tier: "green", src: "Reuters", lang: "en", ts: Date.now() - 1000*60*410 },
    { id: `${iso}-A3`, title: "Central bank governor testifies before legislature", sev: 3.5, tier: "amber", src: "FT", lang: "en", ts: Date.now() - 1000*60*520 },
    { id: `${iso}-A4`, title: "Regional summit concludes with joint communiqué", sev: 2.5, tier: "green", src: "AFP", lang: "fr", ts: Date.now() - 1000*60*640 },
    { id: `${iso}-A5`, title: "Judicial review expected within 30 days", sev: 2.9, tier: "green", src: "Local Wire", lang: "en", ts: Date.now() - 1000*60*780 },
    { id: `${iso}-A6`, title: "Trade delegation concludes multi-day visit", sev: 2.2, tier: "green", src: "Bloomberg", lang: "en", ts: Date.now() - 1000*60*920 },
  ];
  return [...base, ...extras];
}

// Trend series
function trendSeries(seed, len=60, base=40, amp=30){
  const out = [];
  for (let i=0;i<len;i++){
    const v = base + Math.sin(i*0.22 + seed)*amp*0.6 + Math.cos(i*0.11 + seed)*amp*0.4 + (Math.random()-0.5)*8;
    out.push(Math.max(0, v));
  }
  return out;
}

const TRENDS = {
  regional: [
    { label: "Europe",      data: trendSeries(1, 60, 60, 25), color: "var(--amber)" },
    { label: "MENA",        data: trendSeries(5, 60, 75, 35), color: "var(--sev-red)" },
    { label: "East Asia",   data: trendSeries(9, 60, 45, 18), color: "var(--cyan)" },
    { label: "Americas",    data: trendSeries(13, 60, 55, 22), color: "var(--sev-green)" },
  ],
  byCat: [
    { label: "Conflict",  data: trendSeries(21, 30, 40, 30) },
    { label: "Cyber",     data: trendSeries(27, 30, 30, 15) },
    { label: "Unrest",    data: trendSeries(33, 30, 35, 18) },
    { label: "Seismic",   data: trendSeries(39, 30, 20, 10) },
    { label: "Weather",   data: trendSeries(45, 30, 25, 14) },
    { label: "Economic",  data: trendSeries(51, 30, 28, 12) },
  ],
};

window.MAPR_DATA = {
  EVENTS, REGIONS, ANOMALIES, NARRATIVES, ENTITIES, ENTITY_EDGES,
  SOURCES: mkSources(), articlesFor, TRENDS,
};
})();
