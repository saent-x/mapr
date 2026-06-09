/* mapr — synthetic OSINT corpus (illustrative; not live data) */
export const MAPR = (function () {
  // Severity tiers carry ALL the color in this design.
  const TIERS = {
    green:  { key: "green",  label: "LOW",          score: [1, 3.9] },
    amber:  { key: "amber",  label: "ELEVATED",     score: [4, 6.4] },
    red:    { key: "red",    label: "CRITICAL",      score: [6.5, 8.4] },
    black:  { key: "black",  label: "CATASTROPHIC",  score: [8.5, 10] },
  };

  const CATEGORIES = ["conflict", "maritime", "economic", "cyber", "political", "humanitarian", "energy"];

  // [title, lng, lat, iso2, country, category, tier, score, source, sourceType, verified, ageMin, entities, snippet]
  const rawEvents = [
    ["Airstrikes reported across southern Lebanon as ceasefire frays", 35.49, 33.27, "LB", "Lebanon", "conflict", "black", 9.4, "Reuters", "wire", true, 23, ["IDF", "Hezbollah", "Tyre"], "Multiple strikes on Tyre and Nabatieh districts; casualty figures unconfirmed pending local reporting."],
    ["RSF shelling intensifies around El Fasher displacement camps", 25.35, 13.63, "SD", "Sudan", "humanitarian", "black", 9.7, "ReliefWeb", "wire", true, 51, ["RSF", "SAF", "El Fasher"], "Humanitarian corridors cut for a third day; aid agencies report new mass displacement."],
    ["Sudan: conflict signals surge versus prior window", 30.21, 15.50, "SD", "Sudan", "conflict", "red", 8.1, "ACLED", "wire", true, 120, ["RSF", "SAF", "Khartoum"], "Correlated cluster of armed-clash reports across three states."],
    ["Drone incursion forces shipping diversions in the Bab-el-Mandeb", 43.32, 12.58, "YE", "Yemen", "maritime", "red", 7.9, "Lloyd's List", "wire", true, 88, ["Houthi", "Red Sea", "tanker"], "Two operators reroute around the Cape; insurers widen the war-risk zone."],
    ["Grid operator declares emergency after substation outage", 30.52, 50.45, "UA", "Ukraine", "energy", "red", 7.2, "Local wire", "local", true, 64, ["DTEK", "Kyiv"], "Rolling blackouts ordered as repair crews assess transformer damage."],
    ["Cross-border shelling reported along the eastern front", 37.62, 48.02, "UA", "Ukraine", "conflict", "red", 7.6, "AFP", "wire", true, 41, ["Donetsk"], "Artillery exchanges near contested settlements; figures disputed."],
    ["Ransomware disrupts port logistics terminal", 4.40, 51.92, "NL", "Netherlands", "cyber", "amber", 5.8, "BleepingComputer", "wire", true, 200, ["APT", "Rotterdam"], "Container scheduling systems offline; manual fallback in place."],
    ["Coup rumor circulates on social channels — unverified", 7.49, 9.06, "NG", "Nigeria", "political", "amber", 4.6, "Telegram channel", "social", false, 35, ["Abuja"], "Claims of unusual troop movements; no corroboration from established outlets."],
    ["Currency falls sharply amid liquidity squeeze", 51.39, 35.69, "IR", "Iran", "economic", "amber", 5.4, "Bloomberg", "wire", true, 300, ["rial", "Tehran"], "Black-market rate gaps widen; central bank signals intervention."],
    ["Gang blockade chokes fuel deliveries in the capital", -72.33, 18.59, "HT", "Haiti", "humanitarian", "red", 7.4, "UN News", "wire", true, 150, ["Port-au-Prince", "G9"], "Hospitals ration generators; aid flights suspended."],
    ["Junta declares state of emergency after border clashes", 2.63, 13.51, "BF", "Burkina Faso", "conflict", "red", 6.9, "AFP", "wire", true, 210, ["JNIM", "Ouagadougou"], "Curfew imposed across three regions."],
    ["Maritime militia detains crew near contested reef", 115.0, 9.5, "PH", "Philippines", "maritime", "amber", 5.9, "Reuters", "wire", true, 175, ["South China Sea", "coast guard"], "Standoff de-escalates after several hours; vessel released."],
    ["Earthquake aftershocks hamper relief in remote districts", 70.0, 36.5, "AF", "Afghanistan", "humanitarian", "amber", 5.1, "OCHA", "wire", true, 420, ["Herat"], "Access constrained by damaged roads."],
    ["Pipeline pressure anomaly flagged by monitoring station", 53.3, 56.0, "RU", "Russia", "energy", "amber", 4.8, "Industry monitor", "local", false, 260, ["pipeline"], "Cause undetermined; operator investigating."],
    ["Protests over fuel prices turn violent in two cities", 36.82, -1.29, "KE", "Kenya", "political", "amber", 5.3, "Reuters", "wire", true, 95, ["Nairobi"], "Police deploy tear gas; arrests reported."],
    ["Cyber intrusion attributed to state-aligned group", 121.5, 25.0, "TW", "Taiwan", "cyber", "red", 6.7, "Recorded Future", "wire", true, 130, ["APT", "Taipei"], "Targeting of telecom infrastructure; attribution preliminary."],
    ["M23 advance displaces thousands near provincial hub", 29.2, -1.68, "CD", "DR Congo", "conflict", "red", 7.7, "MSF", "wire", true, 70, ["M23", "Goma"], "Clinics overwhelmed; supply lines threatened."],
    ["Naval drill raises tensions in the strait", 119.5, 23.5, "TW", "Taiwan", "maritime", "amber", 5.6, "Reuters", "wire", true, 240, ["strait"], "Civil aviation reroutes; no incidents reported."],
    ["Flooding submerges agricultural belt; harvest at risk", 90.4, 23.8, "BD", "Bangladesh", "humanitarian", "amber", 5.0, "OCHA", "wire", true, 510, ["Dhaka"], "Tens of thousands relocated to shelters."],
    ["Border skirmish reported in disputed sector", 77.0, 34.1, "IN", "India", "conflict", "amber", 4.9, "PTI", "wire", true, 330, ["LAC"], "Both sides claim restraint; patrols increased."],
    ["Strike on energy depot ignites large fire", 39.2, 47.1, "RU", "Russia", "energy", "red", 6.6, "Local wire", "local", false, 58, ["depot"], "Air-defense activity reported; damage assessment pending."],
    ["Famine conditions confirmed in besieged enclave", 28.4, 11.0, "SD", "Sudan", "humanitarian", "black", 9.1, "IPC", "wire", true, 480, ["IPC", "Darfur"], "Phase 5 classification declared for affected population."],
    ["Coastal storm surge prompts evacuation orders", -90.1, 29.9, "US", "United States", "humanitarian", "green", 3.4, "NWS", "wire", true, 140, ["Gulf Coast"], "Mandatory evacuations for low-lying parishes."],
    ["Disinformation network amplifies election claims", 13.4, 52.5, "DE", "Germany", "cyber", "green", 3.1, "DFRLab", "wire", true, 600, ["bots"], "Coordinated inauthentic behavior flagged across platforms."],
    ["Mine blast on key highway disrupts trade route", 1.0, 16.0, "ML", "Mali", "conflict", "amber", 5.7, "AFP", "wire", true, 190, ["JNIM", "Gao"], "Commercial convoys suspended pending clearance."],
    ["Tanker collision spills fuel near busy lane", 103.8, 1.26, "SG", "Singapore", "maritime", "amber", 4.4, "Reuters", "wire", true, 270, ["Malacca"], "Containment booms deployed; lane partially closed."],
    ["Bank run rumor spreads on messaging apps — unverified", 31.2, 30.0, "EG", "Egypt", "economic", "green", 3.6, "WhatsApp forwards", "social", false, 80, ["Cairo"], "No confirmation from regulator; deposits reportedly stable."],
    ["Volcanic ash cloud reroutes regional flights", 112.9, -7.5, "ID", "Indonesia", "humanitarian", "green", 3.0, "VAAC", "wire", true, 360, ["aviation"], "Airspace advisories issued for eastern corridors."],
    ["Militant ambush on patrol leaves several wounded", 14.5, 13.0, "TD", "Chad", "conflict", "amber", 5.2, "AFP", "wire", true, 220, ["Lake Chad"], "Reinforcements dispatched to the area."],
    ["Cyberattack knocks out municipal services", -58.4, -34.6, "AR", "Argentina", "cyber", "amber", 4.7, "Local wire", "local", true, 410, ["ransomware"], "Online portals down; restoration underway."],
    ["Drought emergency declared across pastoral zones", 45.3, 2.0, "SO", "Somalia", "humanitarian", "red", 6.8, "OCHA", "wire", true, 540, ["pastoralists"], "Livestock losses mount; appeal under-funded."],
    ["Naval blockade tightens around contested port", 36.6, 14.0, "ER", "Eritrea", "maritime", "amber", 5.5, "Reuters", "wire", true, 300, ["Red Sea"], "Shipping advisories updated."],
    ["Refinery outage tightens regional fuel supply", -66.9, 10.5, "VE", "Venezuela", "energy", "amber", 5.0, "Argus", "wire", true, 350, ["PDVSA"], "Exports curtailed; queues at stations."],
    ["Political detentions reported ahead of vote", 90.4, 23.7, "BD", "Bangladesh", "political", "amber", 4.5, "HRW", "wire", true, 600, ["opposition"], "Rights groups call for releases."],
    ["Sabotage suspected in undersea cable fault", 20.0, 59.0, "FI", "Finland", "cyber", "red", 6.5, "Reuters", "wire", true, 110, ["Baltic", "cable"], "Two cables degraded; investigation opened."],
    ["Avalanche of displacement as front line shifts", 30.0, 48.5, "UA", "Ukraine", "humanitarian", "amber", 5.9, "UNHCR", "wire", true, 160, ["evacuation"], "Buses organized for at-risk towns."],
    ["Coup attempt reported; outcome unclear — developing", -13.7, 9.5, "GN", "Guinea", "political", "red", 6.6, "AFP", "wire", false, 30, ["Conakry"], "Gunfire near state broadcaster; situation fluid."],
    ["Insurgent attack on gas facility halts output", 40.5, -12.9, "MZ", "Mozambique", "energy", "red", 6.9, "Reuters", "wire", true, 180, ["Cabo Delgado", "LNG"], "Force majeure considered by operator."],
    ["Mass protest paralyzes capital over reforms", -74.1, 4.7, "CO", "Colombia", "political", "amber", 4.8, "Reuters", "wire", true, 90, ["Bogota"], "Transit suspended; talks proposed."],
    ["Cholera outbreak strains clinics in flood zone", 36.3, -15.4, "MW", "Malawi", "humanitarian", "amber", 5.4, "WHO", "wire", true, 470, ["cholera"], "Treatment centers at capacity."],
  ];

  let _id = 1000;
  const events = rawEvents.map((r) => {
    const [title, lng, lat, iso2, country, category, tier, score, source, sourceType, verified, ageMin, entities, snippet] = r;
    return {
      id: "e" + (++_id),
      title, lng, lat, iso2, country, category, tier, score,
      source, sourceType, verified, ageMin, entities, snippet,
      // first-seen relative to "now" for baseline diff demos
      firstSeenMin: ageMin,
      // frozen provenance — snapshot pinned at ingest
      snapshotMin: ageMin,                       // captured this long ago
      contentHash: "sha256:" + Math.abs((title.length * 2654435761) % 0xffffff).toString(16).padStart(6, "0") + "…",
      textChanged: ageMin < 130 && score > 7,    // source stealth-edited since capture
      corroboration: verified ? (score > 7 ? 5 : 3) : 1,  // independent corroborating sources
    };
  });

  function ago(min) {
    if (min < 60) return min + "m";
    if (min < 1440) return Math.round(min / 60) + "h";
    return Math.round(min / 1440) + "d";
  }

  // Regions with computed anomaly deltas (backward-looking, measured — never "forecast")
  const regions = [
    { iso2: "SD", name: "Sudan", events: events.filter(e => e.iso2 === "SD").length, delta: +240, topCat: "conflict", tier: "black" },
    { iso2: "LB", name: "Lebanon", events: events.filter(e => e.iso2 === "LB").length, delta: +180, topCat: "conflict", tier: "black" },
    { iso2: "UA", name: "Ukraine", events: events.filter(e => e.iso2 === "UA").length, delta: +35, topCat: "conflict", tier: "red" },
    { iso2: "HT", name: "Haiti", events: events.filter(e => e.iso2 === "HT").length, delta: +60, topCat: "humanitarian", tier: "red" },
    { iso2: "YE", name: "Yemen", events: events.filter(e => e.iso2 === "YE").length, delta: +95, topCat: "maritime", tier: "red" },
    { iso2: "TW", name: "Taiwan", events: events.filter(e => e.iso2 === "TW").length, delta: +20, topCat: "cyber", tier: "red" },
    { iso2: "CD", name: "DR Congo", events: events.filter(e => e.iso2 === "CD").length, delta: +48, topCat: "conflict", tier: "red" },
  ];

  // Computed signals — anomalies + watch hits + fired alerts (the push side)
  const signals = [
    { id: "s1", kind: "anomaly", scope: "Sudan", iso2: "SD", tier: "black", text: "Conflict signals +240% vs prior 72h", detail: "27 new clash reports clustered across 3 states", min: 18 },
    { id: "s2", kind: "watch", scope: "Red Sea corridor", iso2: "YE", tier: "red", text: "NEW since baseline — 2 maritime diversions", detail: "Watch \u201cRed Sea shipping\u201d crossed threshold", min: 42 },
    { id: "s3", kind: "alert", scope: "Lebanon", iso2: "LB", tier: "black", text: "Black-tier event fired your alert", detail: "Alert \u201cLevant escalation\u201d \u00b7 ceasefire strikes", min: 23 },
    { id: "s4", kind: "anomaly", scope: "Baltic Sea", iso2: "FI", tier: "red", text: "Cyber/infrastructure +110% vs prior 7d", detail: "Undersea cable faults correlate to vessel track", min: 110 },
    { id: "s5", kind: "watch", scope: "Sahel", iso2: "BF", tier: "red", text: "NEW since baseline — 1 emergency declaration", detail: "Watch \u201cSahel coups\u201d \u00b7 state of emergency", min: 210 },
    { id: "s6", kind: "anomaly", scope: "Haiti", iso2: "HT", tier: "red", text: "Humanitarian +60% vs prior 72h", detail: "Fuel blockade compounds clinic outages", min: 150 },
  ];

  const watches = [
    { id: "w1", name: "Red Sea shipping", scope: "MARITIME \u00b7 Bab-el-Mandeb bbox", baselineMin: 4320, baselineCount: 3, nowCount: 5, newCount: 2, resolved: 0, escalated: 1, live: true },
    { id: "w2", name: "Levant escalation", scope: "REGION \u00b7 LB, IL, SY", baselineMin: 10080, baselineCount: 9, nowCount: 14, newCount: 6, resolved: 1, escalated: 3, live: true },
    { id: "w3", name: "Sahel coups", scope: "REGION \u00b7 ML, BF, NE, TD", baselineMin: 20160, baselineCount: 6, nowCount: 9, newCount: 3, resolved: 0, escalated: 2, live: false },
    { id: "w4", name: "Sudan corridor", scope: "REGION \u00b7 SD \u00b7 conflict+humanitarian", baselineMin: 7200, baselineCount: 11, nowCount: 21, newCount: 12, resolved: 2, escalated: 5, live: true },
  ];

  const cases = [
    { id: "c1", title: "Levant ceasefire breakdown", items: 14, updatedMin: 35, scope: "LB, IL \u00b7 conflict \u00b7 7d", tier: "black", contributors: 2 },
    { id: "c2", title: "Red Sea freight risk", items: 9, updatedMin: 220, scope: "Bab-el-Mandeb \u00b7 maritime \u00b7 14d", tier: "red", contributors: 1 },
    { id: "c3", title: "Sahel instability watch", items: 11, updatedMin: 1440, scope: "ML, BF, NE \u00b7 political \u00b7 30d", tier: "red", contributors: 3 },
  ];

  const entities = [
    { name: "Hezbollah", type: "ORG", mentions: 38, regions: ["LB", "IL", "SY"], cooccur: ["IDF", "Tyre", "UNIFIL"], tier: "black" },
    { name: "RSF", type: "ORG", mentions: 51, regions: ["SD"], cooccur: ["SAF", "El Fasher", "Darfur"], tier: "black" },
    { name: "Houthi", type: "ORG", mentions: 29, regions: ["YE"], cooccur: ["Red Sea", "tanker", "Bab-el-Mandeb"], tier: "red" },
    { name: "M23", type: "ORG", mentions: 22, regions: ["CD", "RW"], cooccur: ["Goma", "FARDC"], tier: "red" },
    { name: "JNIM", type: "ORG", mentions: 18, regions: ["ML", "BF", "NE"], cooccur: ["Gao", "Ouagadougou"], tier: "red" },
  ];

  // Trends series (per category counts over last 7 buckets)
  const trends = {
    buckets: ["6d", "5d", "4d", "3d", "2d", "1d", "now"],
    series: [
      { cat: "conflict", color: "red", values: [22, 25, 24, 31, 38, 44, 51], delta: +132 },
      { cat: "humanitarian", color: "amber", values: [14, 13, 16, 18, 22, 27, 33], delta: +135 },
      { cat: "maritime", color: "red", values: [6, 7, 9, 8, 11, 12, 14], delta: +133 },
      { cat: "cyber", color: "amber", values: [9, 8, 11, 10, 12, 13, 12], delta: +33 },
    ],
  };

  // A canned grounded investigation answer for the demo (deterministic + cited)
  const sampleAnswer = {
    query: "What's driving the Sudan conflict surge — and what changed this week?",
    scope: { region: "Sudan (SD)", window: "7d", categories: ["conflict", "humanitarian"] },
    bottomLine: "Fighting around El Fasher has sharply escalated, with RSF shelling of displacement camps and a confirmed famine classification driving Sudan to the top of this week's movers.",
    strength: { level: "HIGH", sources: 6, verified: 4, social: 1, note: "Known corpus \u00b7 reproducible" },
    facts: [
      { label: "Events in scope", value: "21", sub: "+91% vs prior 7d" },
      { label: "Severity mix", value: "3 black \u00b7 5 red \u00b7 4 amber", sub: "median 7.8" },
      { label: "Top entities", value: "RSF \u00b7 SAF \u00b7 El Fasher", sub: "co-occur 17\u00d7" },
    ],
    evidenceIds: ["e1002", "e1022", "e1003"],
    whatChanged: "Humanitarian +135% vs prior 7d \u00b7 first IPC Phase-5 classification in scope \u00b7 2 events escalated to black-tier",
    // #5 corroboration lattice for the bottom-line claim
    corroboration: {
      claim: "RSF shelling of El Fasher displacement camps with confirmed famine classification",
      sources: [
        { name: "ReliefWeb", type: "wire", stance: "corroborates", min: 51, independent: true },
        { name: "IPC", type: "wire", stance: "corroborates", min: 480, independent: true },
        { name: "ACLED", type: "wire", stance: "corroborates", min: 120, independent: true },
        { name: "MSF field", type: "local", stance: "corroborates", min: 70, independent: true },
        { name: "State media", type: "wire", stance: "contradicts", min: 90, independent: false },
        { name: "Telegram", type: "social", stance: "single", min: 35, independent: false },
      ],
      verdict: "4 independent wires corroborate; 1 state outlet contradicts casualty scale",
    },
  };

  // #6 Silence detection — absence-of-signal (only a corpus that knows baseline volume can see this)
  const silenceSignals = [
    { id: "z1", kind: "silence", scope: "Khartoum metro", iso2: "SD", tier: "red", text: "Comms blackout — volume −86% vs 30d baseline", detail: "Expected ~14 reports/6h; observed 2. Internet-shutdown pattern matches prior pre-offensive lulls.", min: 38, baseline: 14, observed: 2 },
    { id: "z2", kind: "silence", scope: "Gaza north", iso2: "IL", tier: "amber", text: "Reporting gap — volume −64% vs baseline", detail: "Local stringers offline 9h. Absence itself is the signal.", min: 95, baseline: 9, observed: 3 },
  ];

  // #7 Entity knowledge graph — canonicalized aliases + weighted co-occurrence edges
  const entityGraph = {
    RSF: {
      canonical: "Rapid Support Forces",
      aliases: ["RSF", "Rapid Support Forces", "\u0627\u0644\u062f\u0639\u0645 \u0627\u0644\u0633\u0631\u064a\u0639", "Hemedti forces"],
      firstSeen: "March 2023", mentions: 51, trend: +132,
      nodes: [
        { id: "RSF", label: "RSF", weight: 51, self: true },
        { id: "SAF", label: "SAF", weight: 44 },
        { id: "El Fasher", label: "El Fasher", weight: 31 },
        { id: "Darfur", label: "Darfur", weight: 27 },
        { id: "Hemedti", label: "Hemedti", weight: 19 },
        { id: "Khartoum", label: "Khartoum", weight: 16 },
      ],
      edges: [["RSF","SAF",17],["RSF","El Fasher",14],["RSF","Darfur",12],["RSF","Hemedti",11],["RSF","Khartoum",8],["SAF","Khartoum",6],["El Fasher","Darfur",9]],
    },
    Hezbollah: {
      canonical: "Hezbollah", aliases: ["Hezbollah", "Hizbullah", "\u062d\u0632\u0628 \u0627\u0644\u0644\u0647", "the Party of God"],
      firstSeen: "ongoing", mentions: 38, trend: +180,
      nodes: [
        { id: "Hezbollah", label: "Hezbollah", weight: 38, self: true },
        { id: "IDF", label: "IDF", weight: 33 },
        { id: "Tyre", label: "Tyre", weight: 18 },
        { id: "UNIFIL", label: "UNIFIL", weight: 12 },
        { id: "Nabatieh", label: "Nabatieh", weight: 9 },
      ],
      edges: [["Hezbollah","IDF",21],["Hezbollah","Tyre",13],["Hezbollah","UNIFIL",8],["Hezbollah","Nabatieh",7],["IDF","Tyre",6]],
    },
  };

  // #8 Bring-your-own feeds + self-hosted sovereignty
  const feeds = [
    { id: "f1", name: "Reuters World", type: "WIRE", health: "ok", volume: [4,5,6,5,7,8,9], perDay: 312, enabled: true, owned: false },
    { id: "f2", name: "AFP Global", type: "WIRE", health: "ok", volume: [3,4,4,5,5,6,6], perDay: 248, enabled: true, owned: false },
    { id: "f3", name: "ReliefWeb / OCHA", type: "NGO", health: "ok", volume: [2,2,3,3,4,5,6], perDay: 96, enabled: true, owned: false },
    { id: "f4", name: "ACLED conflict export", type: "DATA", health: "lagging", volume: [5,4,3,2,2,1,1], perDay: 140, enabled: true, owned: false, note: "ingest 6h behind" },
    { id: "f5", name: "Beirut stringers (private)", type: "TELEGRAM", health: "ok", volume: [1,2,4,3,5,6,4], perDay: 54, enabled: true, owned: true },
    { id: "f6", name: "Field desk RSS (yours)", type: "RSS", health: "ok", volume: [0,1,1,2,2,3,3], perDay: 22, enabled: false, owned: true },
  ];

  // #9 Shared case with forensic audit trail
  const caseDetail = {
    c1: {
      title: "Levant ceasefire breakdown",
      evidenceIds: ["e1001", "e1003"],
      audit: [
        { who: "You", action: "created case", min: 600 },
        { who: "You", action: "pinned 4 events from investigation", min: 540 },
        { who: "R. Haddad", action: "added 2 maritime events", min: 320, ext: true },
        { who: "System", action: "auto-flagged source edit on evidence #2", min: 210, sys: true },
        { who: "R. Haddad", action: "wrote analyst note", min: 90, ext: true },
        { who: "You", action: "promoted to shared board", min: 35 },
      ],
      note: "Ceasefire breach corroborated by 4 independent wires; casualty figures still contested. Holding for IPC update.",
    },
  };

  // ── Account (mirrors users schema: role, subscriptionStatus, qa quota) ──
  const account = {
    name: "Dana Okonkwo",
    email: "dana@frontline-osint.org",
    org: "Frontline OSINT Collective",
    role: "admin",                 // "user" | "admin"
    emailVerified: true,
    plan: "free",                  // free | active(=pro) | past_due | canceled
    memberSince: "Feb 2026",
    initials: "DO",
    // QA quota — free 10 / pro 200 per trailing 30d window
    qa: { used: 7, limit: 10, windowEndsMin: 12960 },
    usage: { watches: 4, cases: 3, evidencePinned: 23, signalsToday: 8 },
    settings: {
      digestCadence: "daily",      // off | realtime | daily | weekly
      digestEmail: true,
      alertStream: true,
      blackTierPush: true,
      weeklyReport: false,
    },
    instance: {
      host: "watch.frontline-osint.org",
      version: "mapr 0.9.2 · self-hosted",
      model: "qwen2.5:3b · bge-m3 (1024d)",
      region: "on-prem · EU-central box",
      uptimeDays: 47,
    },
  };

  // ── Admin (mirrors admin.health + sourceCatalog + featureFlags + sourceRequests) ──
  const admin = {
    health: {
      events6h: 218,
      eventsDelta: +14,
      ingestCycleMin: 6,           // last cycle ran N min ago
      cycleCadence: "15 min",
      modelStatus: "ready",        // ready | busy | degraded
      modelLatencyMs: 1840,
      embedQueue: 0,
      tierCount: { green: 96, amber: 78, red: 36, black: 8 },
    },
    sources: [
      { id: "sc1", name: "Reuters World", url: "reuters.com/world", kind: "rss", type: "wire", verification: "verified", enabled: true, lastStatus: "200", lastFetchedMin: 4, failures: 0, items: 13402, lang: "en", coverage: "Global" },
      { id: "sc2", name: "AFP Global", url: "afp.com/en", kind: "rss", type: "wire", verification: "verified", enabled: true, lastStatus: "200", lastFetchedMin: 6, failures: 0, items: 11218, lang: "en", coverage: "Global" },
      { id: "sc3", name: "GDELT 2.0 event stream", url: "gdeltproject.org", kind: "gdelt", type: "other", verification: "mixed", enabled: true, lastStatus: "200", lastFetchedMin: 9, failures: 0, items: 48190, lang: "mul", coverage: "Global" },
      { id: "sc4", name: "ReliefWeb / OCHA", url: "reliefweb.int", kind: "rss", type: "ngo", verification: "verified", enabled: true, lastStatus: "200", lastFetchedMin: 12, failures: 0, items: 5604, lang: "en", coverage: "Humanitarian" },
      { id: "sc5", name: "ACLED conflict export", url: "acleddata.com", kind: "html", type: "official", verification: "verified", enabled: true, lastStatus: "429", lastFetchedMin: 38, failures: 3, items: 9120, lang: "en", coverage: "Conflict" },
      { id: "sc6", name: "Beirut stringers", url: "t.me/beirut_wire", kind: "bluesky", type: "social", verification: "unverified", enabled: true, lastStatus: "200", lastFetchedMin: 3, failures: 0, items: 880, lang: "ar", coverage: "Levant" },
      { id: "sc7", name: "Lloyd's List maritime", url: "lloydslist.com", kind: "rss", type: "regional", verification: "verified", enabled: false, lastStatus: "401", lastFetchedMin: 1440, failures: 11, items: 2104, lang: "en", coverage: "Maritime" },
    ],
    flags: [
      { key: "correlation_tracer", label: "Correlation Tracer", desc: "Deterministic link-analysis arcs on the map (Pro).", value: true },
      { key: "escalation_chronology", label: "Escalation Chronology", desc: "Scrubbable dated article timeline.", value: true },
      { key: "shared_boards", label: "Shared Boards", desc: "Share + fork spatial workspaces.", value: false },
      { key: "semantic_links", label: "Semantic correlation (experimental)", desc: "Cross-article embedding links — may produce false arcs.", value: false },
      { key: "silence_detection", label: "Silence Detection", desc: "Absence-of-signal anomaly alerts.", value: true },
      { key: "email_digests", label: "Email digests (Resend)", desc: "Scheduled baseline-diff emails.", value: true },
    ],
    requests: [
      { id: "rq1", source: "Kyiv Independent", url: "kyivindependent.com", by: "r.haddad@frontline-osint.org", reason: "Strong English-language Ukraine local desk; fills wire gaps.", min: 180, status: "pending" },
      { id: "rq2", source: "Sudan Tribune", url: "sudantribune.com", by: "dana@frontline-osint.org", reason: "On-the-ground Darfur reporting for the El Fasher watch.", min: 520, status: "pending" },
      { id: "rq3", source: "Insecurity Insight", url: "insecurityinsight.org", by: "m.oduya@frontline-osint.org", reason: "Aid-worker security incidents, NGO-grade.", min: 2880, status: "approved" },
    ],
    cron: [
      { task: "ingest.sweep", min: 6, status: "ok", note: "218 articles · 31 new events" },
      { task: "watches.evaluate", min: 6, status: "ok", note: "4 watches · 2 fired" },
      { task: "digests.send", min: 720, status: "ok", note: "1 email queued (Resend)" },
      { task: "correlate.cluster", min: 6, status: "ok", note: "eventKey clusters rebuilt" },
      { task: "sources.healthcheck", min: 15, status: "warn", note: "ACLED 429 · Lloyd's List 401" },
    ],
  };

  return {
    TIERS, CATEGORIES, events, regions, signals, silenceSignals, watches, cases, caseDetail,
    entities, entityGraph, feeds, trends, sampleAnswer, ago,
    account, admin,
    byId: Object.fromEntries(events.map(e => [e.id, e])),
  };
})();
