export const ISO2_NAME = {
  JP: "Japan",
  TR: "Türkiye",
  US: "United States",
  BE: "Belgium",
  SG: "Singapore",
  FR: "France",
  AR: "Argentina",
  IN: "India",
  EG: "Egypt",
  UA: "Ukraine",
  IL: "Israel",
  SS: "South Sudan",
  CN: "China",
  AU: "Australia",
  GB: "United Kingdom",
  CD: "DR Congo",
  YE: "Yemen",
  HK: "Hong Kong",
  MX: "Mexico",
  DE: "Germany",
  ZA: "South Africa",
  UZ: "Uzbekistan",
  BR: "Brazil",
  RU: "Russia",
  KR: "South Korea",
  SI: "Slovenia",
  CL: "Chile",
  IQ: "Iraq",
  IT: "Italy",
  CH: "Switzerland",
  ET: "Ethiopia",
  BD: "Bangladesh",
};

const DEFAULT_TOPICS = {
  flat: ["regional clusters", "severity spikes"],
  globe: ["cross-border spillover", "maritime pressure"],
};

const TOPIC_PATTERNS = [
  ["cyber", /\b(cyber|malware|ransom|hack|digital)\b/i],
  ["conflict", /\b(conflict|war|attack|strike|military|border)\b/i],
  ["maritime pressure", /\b(maritime|ship|port|sea|route|strait)\b/i],
  ["energy disruption", /\b(energy|oil|gas|power|grid|fuel)\b/i],
  ["civil unrest", /\b(protest|riot|unrest|election|police)\b/i],
  ["food security", /\b(food|grain|hunger|famine|supply)\b/i],
  ["health risk", /\b(health|disease|hospital|outbreak|medical)\b/i],
];

export const regionName = (iso) => ISO2_NAME[iso] || iso;

export const isSocial = (src) => /^(bluesky|mastodon)/i.test(src || "");

export function ago(ts) {
  const seconds = Math.max(0, (Date.now() - ts) / 1000);
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)}h`;
  return `${Math.round(seconds / 86400)}d`;
}

export function fmtReset(ts) {
  if (!ts) return "next period";
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function inferQuestionTopic(text) {
  const source = text || "";
  const match = TOPIC_PATTERNS.find(([, pattern]) => pattern.test(source));
  if (match) return match[0];

  const region = Object.values(ISO2_NAME).find((name) => {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return new RegExp(`\\b${escaped}\\b`, "i").test(source);
  });
  if (region) return region;

  return null;
}

export function generateQuestionSuggestions({ mapMode = "flat", focusedRegion, questionMemory = [] }) {
  const recent = questionMemory.filter(Boolean).slice(0, 8);
  const last = recent[0]?.text || "";
  const lastTopic = inferQuestionTopic(last);
  const fallbackTopics = DEFAULT_TOPICS[mapMode] || DEFAULT_TOPICS.flat;
  const topic = focusedRegion ? regionName(focusedRegion) : lastTopic || fallbackTopics[0];
  const secondaryTopic = lastTopic && lastTopic !== topic ? lastTopic : fallbackTopics[1];

  const primary = mapMode === "globe"
    ? [
        focusedRegion ? `Where could ${topic} spill over?` : "Where could risk spill over?",
        "Which routes matter now?",
      ]
    : [
        focusedRegion ? `What changed around ${topic}?` : "What changed most?",
        "Where is risk heating up?",
      ];

  const memoryPrompt = last
    ? `Follow up on "${last.slice(0, 30)}${last.length > 30 ? "..." : ""}"`
    : `Brief me on the last hour`;

  const secondary = [
    memoryPrompt,
    `Explain the ${secondaryTopic} signal`,
    mapMode === "globe" ? "Show emerging cross-border risks" : "Find unexplained local spikes",
  ];

  const unique = (items) => [...new Set(items.filter(Boolean))];
  return {
    primary: unique(primary).slice(0, 2),
    secondary: unique(secondary).slice(0, 3),
  };
}
