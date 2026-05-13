/**
 * NER pipeline combining compromise.js and a curated gazetteer.
 * Handles English text via compromise and falls back to gazetteer + capitalization
 * patterns for non-English input.
 */

import nlp from 'compromise';
import { GAZETTEER_ORGS } from './entityGazetteer.js';

// ── Entity normalization map ──────────────────────────────────────────────────

/**
 * Maps common entity name variants to a canonical form.
 * Used to normalize extracted entities so that "U.S." and "USA" map to the
 * same canonical name (and similar for other common abbreviations/variants).
 */
const ENTITY_NORMALIZATION_MAP = new Map([
  // Country / location variants
  ['u.s.', 'USA'],
  ['u.s.a.', 'USA'],
  ['us', 'USA'],
  ['united states', 'USA'],
  ['united states of america', 'USA'],
  ['u.k.', 'United Kingdom'],
  ['uk', 'United Kingdom'],
  ['great britain', 'United Kingdom'],
  ['dprk', 'North Korea'],
  ['n. korea', 'North Korea'],
  ['rok', 'South Korea'],
  ['s. korea', 'South Korea'],
  ['prc', 'China'],
  ["people's republic of china", 'China'],

  // Organization variants
  ['un', 'United Nations'],
  ['u.n.', 'United Nations'],
  ['eu', 'European Union'],
  ['e.u.', 'European Union'],
  ['icc', 'International Criminal Court'],
  ['imf', 'International Monetary Fund'],
  ['who', 'World Health Organization'],
  ['wto', 'World Trade Organization'],
  ['n.korea', 'North Korea'],
  ['s.korea', 'South Korea'],

  // Common political abbreviations
  ['govt', 'Government'],
  ['gov.', 'Government'],
  ['dept.', 'Department'],
]);

/**
 * Normalize an entity name to its canonical form.
 *
 * Returns the canonical name if a mapping exists, otherwise returns the
 * input as-is. Case-insensitive lookup.
 *
 * @param {string} name - Entity name to normalize
 * @returns {string} Canonical entity name
 */
export function normalizeEntityName(name) {
  if (!name) return '';

  const trimmed = name.trim();
  const lower = trimmed.toLowerCase();

  // Check direct normalization map
  if (ENTITY_NORMALIZATION_MAP.has(lower)) {
    return ENTITY_NORMALIZATION_MAP.get(lower);
  }

  // Check entity gazetteer for canonical name mapping
  for (const org of GAZETTEER_ORGS) {
    if (org.name.toLowerCase() === lower) return org.name;
    for (const alias of org.aliases) {
      if (alias.toLowerCase() === lower) return org.name;
    }
  }

  return trimmed;
}

/**
 * Normalize a list of entity objects, deduplicating by canonical name.
 *
 * @param {Array<{name: string}>} entities - Array of entity objects
 * @returns {Array<{name: string}>} Normalized, deduplicated entity array
 */
export function normalizeEntityList(entities) {
  const seen = new Map();

  for (const entity of (entities || [])) {
    const canonical = normalizeEntityName(entity.name);
    if (!canonical) continue;

    const lower = canonical.toLowerCase();
    if (!seen.has(lower)) {
      seen.set(lower, { ...entity, name: canonical });
    }
  }

  return [...seen.values()];
}

// ── Event type patterns ────────────────────────────────────────────────────────

const EVENT_PATTERNS = [
  {
    category: 'disaster',
    patterns: [
      /\b(earthquake|quake|tsunami|flood|hurricane|typhoon|cyclone|tornado|wildfire|eruption|landslide|drought|famine|epidemic|pandemic|explosion|collapse|avalanche)\b/i,
      /\b(kills?\s+\d+|rescue\s+operations?|natural\s+disaster|relief\s+effort)\b/i,
    ],
  },
  {
    category: 'conflict',
    patterns: [
      /\b(war|warfare|battle|offensive|airstrike|air\s+strike|bombardment|shelling|troops|forces|militia|rebel|insurgent|ceasefire|cease[\s-]fire|frontline|front\s+line|combat|fighting|clash|attack|ambush|siege|blockade|invasion|occupation|liberation)\b/i,
      /\b(casualties|killed\s+in\s+action|military\s+operation|armed\s+forces|launch\s+offensive|government\s+troops)\b/i,
    ],
  },
  {
    category: 'humanitarian',
    patterns: [
      /\b(refugee|displaced|aid|humanitarian|relief|asylum|shelter|food\s+crisis|water\s+shortage|evacuation|camp|internally\s+displaced|IDPs?|NGO|charity)\b/i,
    ],
  },
  {
    category: 'political',
    patterns: [
      /\b(election|vote|referendum|parliament|congress|senate|president|prime\s+minister|government|coup|protest|demonstration|rally|sanction|diplomacy|diplomatic|treaty|agreement|summit|talks|negotiations?)\b/i,
    ],
  },
  {
    category: 'economic',
    patterns: [
      /\b(economy|economic|inflation|recession|GDP|trade|tariff|sanction|currency|debt|budget|fiscal|investment|stock\s+market|oil\s+price|energy\s+crisis|supply\s+chain)\b/i,
    ],
  },
];

// ── Gazetteer index ───────────────────────────────────────────────────────────

/**
 * Build a flat lookup: every name/alias (lowercased) → canonical org entry.
 */
const GAZETTEER_INDEX = new Map();
for (const org of GAZETTEER_ORGS) {
  GAZETTEER_INDEX.set(org.name.toLowerCase(), org);
  for (const alias of org.aliases) {
    GAZETTEER_INDEX.set(alias.toLowerCase(), org);
  }
}

// Also index distinctive first words of multi-word org names (for non-English partial matches).
// A "distinctive word" is the first word of a multi-word name that is >= 5 chars,
// not a generic English word, and not already in the index.
const GENERIC_WORDS = new Set(['group', 'force', 'forces', 'front', 'army', 'corps', 'league',
  'union', 'party', 'movement', 'council', 'committee', 'organization', 'organisation',
  'international', 'national', 'federal', 'united', 'democratic', 'popular', 'islamic',
  'liberation', 'resistance', 'people', 'peoples', 'african', 'european', 'world']);

for (const org of GAZETTEER_ORGS) {
  const words = org.name.split(/\s+/);
  if (words.length > 1) {
    const firstWord = words[0].toLowerCase();
    if (firstWord.length >= 5 && !GENERIC_WORDS.has(firstWord) && !GAZETTEER_INDEX.has(firstWord)) {
      GAZETTEER_INDEX.set(firstWord, org);
    }
  }
}

// Sorted by length descending so longest match wins when scanning text.
const GAZETTEER_TERMS = [...GAZETTEER_INDEX.keys()].sort((a, b) => b.length - a.length);

// ── Helpers ───────────────────────────────────────────────────────────────────

function classifyEvent(text) {
  for (const { category, patterns } of EVENT_PATTERNS) {
    if (patterns.some(p => p.test(text))) return category;
  }
  return 'general';
}

/**
 * Scan text for gazetteer matches (case-insensitive, whole-word-ish).
 * Returns an array of canonical org objects (deduped by canonical name).
 */
function matchGazetteer(text) {
  const found = new Map(); // canonical name → org entry
  const lower = text.toLowerCase();
  for (const term of GAZETTEER_TERMS) {
    const idx = lower.indexOf(term);
    if (idx === -1) continue;
    // Basic boundary check: char before and after should not be a letter/digit.
    const before = idx === 0 ? ' ' : lower[idx - 1];
    const after = idx + term.length >= lower.length ? ' ' : lower[idx + term.length];
    if (/[a-z0-9]/i.test(before) || /[a-z0-9]/i.test(after)) continue;
    const org = GAZETTEER_INDEX.get(term);
    if (!found.has(org.name)) found.set(org.name, org);
  }
  return [...found.values()];
}

// Tokens that strongly signal a capitalized multi-word phrase is an
// organization (corporate suffixes), not a person.
const ORG_SUFFIX_TOKENS = new Set([
  'inc', 'inc.', 'corp', 'corp.', 'corporation', 'co', 'co.', 'company',
  'ltd', 'ltd.', 'llc', 'plc', 'ag', 'gmbh', 'sa', 'nv', 'pty',
  'group', 'holdings', 'industries', 'partners', 'systems', 'technologies',
  'foundation', 'institute', 'university', 'college', 'school',
  'ministry', 'department', 'bureau', 'agency', 'commission', 'council',
  'committee', 'union', 'association', 'federation', 'organization',
  'organisation', 'authority', 'office',
]);

function looksLikeOrg(name) {
  const tokens = name.toLowerCase().split(/\s+/);
  return tokens.some((t) => ORG_SUFFIX_TOKENS.has(t));
}

/**
 * Extract capitalized multi-word tokens that look like proper nouns.
 * Matches sequences of 2+ capitalized words (supporting accented characters).
 * Returns `{ people, orgs }` instead of dumping everything into the people
 * bucket — corporate-suffix heuristics route obvious orgs correctly.
 */
function extractCapitalizedNames(text, knownOrgNames) {
  const MULTI_WORD_PROPER = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)\b/g;
  const people = [];
  const orgs = [];
  const seen = new Set();
  let m;
  while ((m = MULTI_WORD_PROPER.exec(text)) !== null) {
    const candidate = m[1];
    const lower = candidate.toLowerCase();
    if (seen.has(lower)) continue;
    seen.add(lower);
    if (GAZETTEER_INDEX.has(lower)) continue;
    if (knownOrgNames.some(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))) continue;
    if (looksLikeOrg(candidate)) orgs.push({ name: candidate });
    else people.push({ name: candidate });
  }
  return { people, orgs };
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Extract named entities from a headline/snippet.
 *
 * @param {string} text
 * @returns {Promise<{
 *   people: Array<{name: string}>,
 *   organizations: Array<{name: string, type?: string}>,
 *   locations: Array<{name: string}>,
 *   category: string
 * }>}
 */
export async function extractEntities(text) {
  if (!text || !text.trim()) {
    return { people: [], organizations: [], locations: [], category: 'general' };
  }

  // ── 1. compromise.js NER ──────────────────────────────────────────────────
  const doc = nlp(text);

  const nlpPeople = doc.people().out('array').map(name => ({ name: name.trim() }));
  const nlpOrgs   = doc.organizations().out('array').map(name => ({ name: name.trim() }));
  const nlpPlaces = doc.places().out('array').map(name => ({ name: name.trim() }));

  // ── 2. Gazetteer scan ─────────────────────────────────────────────────────
  const gazetteeredOrgs = matchGazetteer(text);

  // Merge compromise orgs + gazetteer orgs, deduping by canonical name.
  const orgMap = new Map();
  for (const o of nlpOrgs)        orgMap.set(o.name.toLowerCase(), o);
  for (const o of gazetteeredOrgs) orgMap.set(o.name.toLowerCase(), { name: o.name, type: o.type });
  const organizations = [...orgMap.values()];

  // ── 3. Capitalization fallback for non-English proper nouns ──────────────
  const knownOrgNames = organizations.map(o => o.name);
  const knownPersonNames = nlpPeople.map(p => p.name);

  const { people: capPeople, orgs: capOrgs } = extractCapitalizedNames(text, knownOrgNames);

  // Merge people: nlp results + capitalized candidates that look like people.
  const personMap = new Map();
  for (const p of nlpPeople) personMap.set(p.name.toLowerCase(), p);
  for (const p of capPeople) {
    const lower = p.name.toLowerCase();
    if (!knownPersonNames.some((n) => n.toLowerCase() === lower)) {
      personMap.set(lower, p);
    }
  }
  const people = [...personMap.values()];

  // Merge org-suffix candidates into the orgs list.
  for (const o of capOrgs) {
    const lower = o.name.toLowerCase();
    if (!orgMap.has(lower)) orgMap.set(lower, o);
  }
  organizations.length = 0;
  for (const o of orgMap.values()) organizations.push(o);

  // ── 5. Classify event ─────────────────────────────────────────────────────
  const category = classifyEvent(text);

  // ── 6. Normalize all entities to canonical forms ─────────────────────────
  const normalizedPeople = normalizeEntityList(people);
  const normalizedOrgs = normalizeEntityList(organizations);
  const normalizedPlaces = normalizeEntityList(nlpPlaces);

  return {
    people: normalizedPeople,
    organizations: normalizedOrgs,
    locations: normalizedPlaces,
    category,
  };
}
