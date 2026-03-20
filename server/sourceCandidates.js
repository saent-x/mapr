import path from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SOURCE_CANDIDATES_PATH = path.resolve(__dirname, '../data/source-candidates.json');

let cachedCandidates = null;
const DISABLED_CANDIDATE_IDS = new Set([
  'candidate-tt-trinidad-and-tobago-newsday'
]);

function slugify(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function mapPriority(priority) {
  switch (String(priority || '').toLowerCase()) {
    case 'high':
      return 3;
    case 'medium':
      return 4;
    case 'low':
      return 5;
    default:
      return 4;
  }
}

export function getSourceCandidates() {
  if (cachedCandidates) {
    return cachedCandidates;
  }

  const payload = JSON.parse(readFileSync(SOURCE_CANDIDATES_PATH, 'utf8'));
  cachedCandidates = (Array.isArray(payload) ? payload : []).map((entry, index) => ({
    id: entry.id || `candidate-${String(entry.isoA2 || 'xx').toLowerCase()}-${slugify(entry.source || entry.website || index)}`,
    name: entry.source,
    url: entry.website,
    country: entry.country || null,
    isoA2: entry.isoA2 || null,
    sourceType: entry.sourceType || 'local',
    sourceClass: entry.sourceClass || 'local',
    language: entry.language || null,
    fetchMode: entry.mode || 'html',
    cadenceMinutes: Number(entry.cadenceMinutes) || 240,
    enabled: entry.enabled ?? !DISABLED_CANDIDATE_IDS.has(entry.id || `candidate-${String(entry.isoA2 || 'xx').toLowerCase()}-${slugify(entry.source || entry.website || index)}`),
    candidate: true,
    notes: entry.notes || null,
    priority: mapPriority(entry.priority),
    seedIndex: 10_000 + index
  }));

  return cachedCandidates;
}

export { SOURCE_CANDIDATES_PATH };
