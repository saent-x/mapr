/**
 * NER pipeline combining compromise.js and a curated gazetteer.
 * Handles English text via compromise and falls back to gazetteer + capitalization
 * patterns for non-English input.
 */

import nlp from 'compromise';
import { GAZETTEER_ORGS } from './entityGazetteer.js';

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

/**
 * Extract capitalized multi-word tokens that look like proper nouns.
 * Matches sequences of 2+ capitalized words (supporting accented characters).
 * Filters out known single-word stop-words and gazetteer orgs already found.
 */
function extractCapitalizedNames(text, knownOrgNames) {
  const MULTI_WORD_PROPER = /\b([A-Z][a-zà-ÿ]+(?:\s+[A-Z][a-zà-ÿ]+)+)\b/g;
  const results = new Set();
  let m;
  while ((m = MULTI_WORD_PROPER.exec(text)) !== null) {
    const candidate = m[1];
    // Skip if this is already covered by a gazetteer org name or alias.
    const lower = candidate.toLowerCase();
    if (GAZETTEER_INDEX.has(lower)) continue;
    // Skip if it overlaps with any known org name found via gazetteer/compromise.
    if (knownOrgNames.some(n => n.toLowerCase().includes(lower) || lower.includes(n.toLowerCase()))) continue;
    results.add(candidate);
  }
  return [...results].map(name => ({ name }));
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

  const capitalizedCandidates = extractCapitalizedNames(text, knownOrgNames);

  // Separate candidates into people vs. orgs/locations heuristically.
  // For now, treat all multi-word capitalized candidates not already classified
  // as people (they're most commonly person names in non-English headlines).
  const extraPeople = capitalizedCandidates.filter(c => {
    const lower = c.name.toLowerCase();
    return !knownPersonNames.some(n => n.toLowerCase() === lower);
  });

  // ── 4. Merge people ───────────────────────────────────────────────────────
  const personMap = new Map();
  for (const p of nlpPeople)   personMap.set(p.name.toLowerCase(), p);
  for (const p of extraPeople) personMap.set(p.name.toLowerCase(), p);
  const people = [...personMap.values()];

  // ── 5. Classify event ─────────────────────────────────────────────────────
  const category = classifyEvent(text);

  return {
    people,
    organizations,
    locations: nlpPlaces,
    category,
  };
}
