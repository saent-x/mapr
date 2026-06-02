const REGION_GROUPS = [
  {
    label: "Africa",
    aliases: ["africa", "african", "sub-saharan", "sub saharan", "sahel", "horn of africa"],
    iso: [
      "DZ", "AO", "BJ", "BW", "BF", "BI", "CM", "CF", "TD", "CD", "CG", "CI", "DJ", "EG", "ER",
      "ET", "GA", "GM", "GH", "GN", "GW", "KE", "LR", "LY", "MG", "MW", "ML", "MR", "MA", "MZ",
      "NA", "NE", "NG", "RW", "SN", "SL", "SO", "ZA", "SS", "SD", "TZ", "TG", "UG", "ZM", "ZW",
    ],
  },
  {
    label: "Middle East",
    aliases: ["middle east", "mena", "gulf", "levant", "red sea"],
    iso: ["AE", "BH", "EG", "IL", "IR", "IQ", "JO", "KW", "LB", "OM", "PS", "QA", "SA", "SY", "TR", "YE"],
  },
  {
    label: "Europe",
    aliases: ["europe", "european", "western europe", "eastern europe", "balkans", "nordics"],
    iso: ["AL", "AT", "BE", "BG", "CH", "CZ", "DE", "DK", "ES", "FI", "FR", "GB", "GR", "HR", "HU", "IE", "IT", "NL", "NO", "PL", "PT", "RO", "RS", "RU", "SE", "SI", "UA"],
  },
  {
    label: "Asia",
    aliases: ["asia", "asian", "east asia", "south asia", "southeast asia", "central asia"],
    iso: ["AF", "BD", "CN", "HK", "ID", "IN", "JP", "KP", "KR", "MM", "MY", "NP", "PK", "PH", "SG", "LK", "TH", "TW", "UZ", "VN"],
  },
  {
    label: "Americas",
    aliases: ["americas", "latin america", "latam", "south america", "north america"],
    iso: ["AR", "BR", "CA", "CL", "CO", "CU", "MX", "PE", "US", "VE"],
  },
];

const COUNTRY_ALIASES = {
  AF: ["afghanistan"],
  AL: ["albania"],
  DZ: ["algeria"],
  AR: ["argentina"],
  AU: ["australia"],
  AT: ["austria"],
  BD: ["bangladesh"],
  BE: ["belgium", "brussels"],
  BR: ["brazil", "sao paulo", "são paulo"],
  BG: ["bulgaria"],
  CA: ["canada"],
  CL: ["chile"],
  CN: ["china", "beijing"],
  CD: ["dr congo", "drc", "congo"],
  CO: ["colombia"],
  CU: ["cuba"],
  CZ: ["czechia"],
  DK: ["denmark"],
  EG: ["egypt", "cairo"],
  ET: ["ethiopia", "addis"],
  FI: ["finland"],
  FR: ["france", "french", "paris"],
  DE: ["germany", "german", "berlin"],
  GH: ["ghana"],
  GR: ["greece"],
  HK: ["hong kong"],
  IN: ["india", "indian", "delhi", "mumbai"],
  ID: ["indonesia"],
  IR: ["iran"],
  IQ: ["iraq", "baghdad"],
  IE: ["ireland"],
  IL: ["israel", "israeli"],
  IT: ["italy", "italian", "rome"],
  JP: ["japan", "tokyo"],
  JO: ["jordan"],
  KE: ["kenya"],
  KR: ["south korea", "korea", "seoul"],
  LB: ["lebanon"],
  LY: ["libya"],
  MX: ["mexico", "mexico city"],
  MA: ["morocco"],
  NG: ["nigeria"],
  NO: ["norway"],
  PK: ["pakistan"],
  PS: ["palestine", "gaza", "west bank"],
  PH: ["philippines"],
  PL: ["poland"],
  RO: ["romania"],
  RU: ["russia", "russian", "moscow"],
  SA: ["saudi arabia", "saudi"],
  SG: ["singapore"],
  ZA: ["south africa", "cape town"],
  SS: ["south sudan"],
  SD: ["sudan"],
  SE: ["sweden"],
  CH: ["switzerland", "swiss"],
  SY: ["syria"],
  TR: ["turkey", "türkiye", "turkiye"],
  UA: ["ukraine", "ukrainian", "kyiv"],
  AE: ["uae", "united arab emirates"],
  GB: ["uk", "britain", "british", "united kingdom", "london", "england"],
  US: ["usa", "us", "united states", "america", "american"],
  UZ: ["uzbekistan"],
  YE: ["yemen"],
};

const CATEGORY_PATTERNS = [
  ["conflict", /\b(conflict|war|attack|strike|military|border|ceasefire|drone|troops?)\b/i],
  ["cyber", /\b(cyber|ransomware|hack|breach|malware|phishing|ddos)\b/i],
  ["unrest", /\b(protest|riot|unrest|election|police|civil)\b/i],
  ["weather", /\b(flood|storm|wildfire|drought|cyclone|hurricane|weather)\b/i],
  ["seismic", /\b(earthquake|quake|seismic|tremor|tsunami)\b/i],
  ["health", /\b(health|outbreak|disease|cholera|dengue|measles)\b/i],
  ["maritime", /\b(maritime|shipping|ship|port|strait|naval|tanker)\b/i],
  ["economic", /\b(economic|inflation|market|currency|energy|oil|gas|power)\b/i],
];

const TIER_PATTERNS = [
  ["black", /\b(black|catastrophic|catastrophe)\b/i],
  ["red", /\b(red|critical|severe|high severity|highest severity|serious)\b/i],
  ["amber", /\b(amber|elevated|moderate)\b/i],
  ["green", /\b(green|low|minor|nominal)\b/i],
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function mentions(text, phrase) {
  return new RegExp(`(^|[^a-z0-9])${escapeRegExp(phrase)}([^a-z0-9]|$)`, "i").test(text);
}

function unique(items) {
  return [...new Set(items.filter(Boolean))];
}

function idsFor(events) {
  return events.map((event) => String(event._id));
}

function describeRegions(groups, regions) {
  if (groups.length) return unique(groups.map((group) => group.label)).join(" / ");
  if (regions.length === 1) return regions[0];
  if (regions.length > 1) return `${regions.length} regions`;
  return null;
}

function resolveRegions(text) {
  const groups = REGION_GROUPS.filter((group) => group.aliases.some((alias) => mentions(text, alias)));
  const regions = new Set(groups.flatMap((group) => group.iso));

  for (const [iso, aliases] of Object.entries(COUNTRY_ALIASES)) {
    if (aliases.some((alias) => mentions(text, alias))) regions.add(iso);
  }

  return { groups, regions: [...regions] };
}

function resolveFacets(text) {
  return {
    categories: CATEGORY_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([category]) => category),
    tiers: TIER_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(([tier]) => tier),
  };
}

export function deriveMapReaction({ question = "", answer = "", citations = [], events = [] }) {
  const combinedText = `${question} ${answer}`.trim();
  if (!combinedText || !events.length) return null;

  const questionRegions = resolveRegions(question);
  const answerRegions = resolveRegions(answer);
  const groups = questionRegions.groups.length ? questionRegions.groups : answerRegions.groups;
  const regions = questionRegions.regions.length ? questionRegions.regions : answerRegions.regions;

  const questionFacets = resolveFacets(question);
  const answerFacets = resolveFacets(answer);
  const useAnswerCategories = !questionFacets.categories.length && !questionRegions.regions.length && answerRegions.regions.length;
  const categories = questionFacets.categories.length
    ? questionFacets.categories
    : useAnswerCategories
      ? answerFacets.categories
      : [];
  const tiers = questionFacets.tiers;
  const hasContext = regions.length > 0 || categories.length > 0 || tiers.length > 0;

  if (hasContext) {
    let matched = events;
    if (regions.length) {
      const regionSet = new Set(regions);
      matched = matched.filter((event) => regionSet.has(event.isoA2));
    }
    if (categories.length) {
      const categorySet = new Set(categories);
      matched = matched.filter((event) => categorySet.has(event.category));
    }
    if (tiers.length) {
      const tierSet = new Set(tiers);
      matched = matched.filter((event) => tierSet.has(event.tier));
    }

    const regionLabel = describeRegions(groups, regions);
    const scopeParts = [regionLabel, categories.join(" / "), tiers.length ? `${tiers.join("/")} tier` : null].filter(Boolean);
    return {
      eventIds: idsFor(matched),
      focusIso: regions.length === 1 ? regions[0] : null,
      regionParam: regions.length === 1 ? regions[0] : null,
      scope: `context · ${scopeParts.join(" · ")}`,
      source: "semantic",
    };
  }

  const byId = new Map(events.map((event) => [String(event._id), event]));
  const citationEvents = unique(citations.map((citation) => citation?.eventId))
    .map((id) => byId.get(String(id)))
    .filter(Boolean);

  if (citationEvents.length) {
    const citationRegions = unique(citationEvents.map((event) => event.isoA2));
    return {
      eventIds: idsFor(citationEvents),
      focusIso: citationRegions.length === 1 ? citationRegions[0] : null,
      regionParam: citationRegions.length === 1 ? citationRegions[0] : null,
      scope: citationRegions.length === 1 ? `AI sources · ${citationRegions[0]}` : `AI sources · ${citationEvents.length} events`,
      source: "citations",
    };
  }

  return null;
}
