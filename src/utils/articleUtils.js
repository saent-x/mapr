// Severity keywords — matched against article titles
const SEVERITY_KEYWORDS = {
  critical: [
    'killed', 'deaths', 'dead', 'massacre', 'bombing', 'explosion', 'earthquake',
    'tsunami', 'hurricane', 'cyclone', 'typhoon', 'famine', 'genocide', 'war ',
    'invasion', 'airstrike', 'missile', 'catastroph', 'devastat', 'collapse',
    'mass shooting', 'terror attack', 'nuclear'
  ],
  high: [
    'crisis', 'emergency', 'disaster', 'flood', 'wildfire', 'drought', 'epidemic',
    'outbreak', 'pandemic', 'conflict', 'attack', 'rebel', 'militant', 'refugee',
    'displacement', 'evacuati', 'casualt', 'injur', 'trapped', 'rescue',
    'severe', 'critical', 'urgent', 'siege', 'shelling'
  ],
  elevated: [
    'protest', 'unrest', 'tension', 'clashes', 'strike', 'riot', 'sanctions',
    'shortage', 'blackout', 'outage', 'landslide', 'storm', 'warning',
    'threat', 'arrest', 'detained', 'violence', 'corruption', 'coup',
    'inflation', 'recession', 'collapse'
  ],
  moderate: [
    'concern', 'risk', 'dispute', 'debate', 'rally', 'march', 'demand',
    'investigation', 'allegation', 'scandal', 'controversy', 'delay',
    'disruption', 'closure', 'restriction', 'ban'
  ]
};

/**
 * Derive a severity score (0-100) from an article title.
 */
export function deriveSeverity(title) {
  const lower = (title || '').toLowerCase();

  for (const keyword of SEVERITY_KEYWORDS.critical) {
    if (lower.includes(keyword)) return 85 + Math.floor(Math.random() * 10);
  }
  for (const keyword of SEVERITY_KEYWORDS.high) {
    if (lower.includes(keyword)) return 70 + Math.floor(Math.random() * 15);
  }
  for (const keyword of SEVERITY_KEYWORDS.elevated) {
    if (lower.includes(keyword)) return 50 + Math.floor(Math.random() * 18);
  }
  for (const keyword of SEVERITY_KEYWORDS.moderate) {
    if (lower.includes(keyword)) return 35 + Math.floor(Math.random() * 15);
  }

  return 20 + Math.floor(Math.random() * 15);
}

/**
 * Derive a category from an article title.
 */
export function deriveCategory(title) {
  const lower = (title || '').toLowerCase();

  if (/earthquake|tsunami|volcano|eruption|seismic|aftershock/i.test(lower)) return 'Seismic';
  if (/flood|storm|hurricane|cyclone|typhoon|tornado|rain|snow|heat|cold|drought|wildfire|fire/i.test(lower)) return 'Weather';
  if (/war |attack|bomb|missile|airstrike|military|army|rebel|militia|terror/i.test(lower)) return 'Conflict';
  if (/protest|rally|march|riot|strike|demonstration|unrest|coup/i.test(lower)) return 'Civil';
  if (/refugee|humanitarian|aid|famine|displacement|hunger|relief/i.test(lower)) return 'Humanitarian';
  if (/outbreak|pandemic|epidemic|virus|disease|health|hospital|vaccine/i.test(lower)) return 'Health';
  if (/power|grid|infrastructure|bridge|road|pipeline|internet|outage|blackout/i.test(lower)) return 'Infrastructure';
  if (/climate|emission|pollution|deforestation|ocean|warming|carbon/i.test(lower)) return 'Climate';
  if (/economy|inflation|recession|market|trade|gdp|unemployment|debt/i.test(lower)) return 'Economic';
  if (/election|vote|parliament|president|minister|legislation|law|policy/i.test(lower)) return 'Political';

  return 'General';
}

/**
 * Normalize a title for deduplication comparison.
 */
function normalizeTitle(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

/**
 * Deduplicate articles by normalized title.
 * Prefers articles with real summaries (not equal to title) over title-only ones.
 */
export function deduplicateArticles(articles) {
  const seen = new Map();
  const result = [];

  for (const article of articles) {
    const key = normalizeTitle(article.title);
    if (!key) continue;

    if (seen.has(key)) {
      const existing = seen.get(key);
      // Prefer the version with a real summary
      if (article.summary !== article.title && existing.summary === existing.title) {
        const idx = result.indexOf(existing);
        if (idx !== -1) result[idx] = article;
        seen.set(key, article);
      }
      continue;
    }
    seen.set(key, article);
    result.push(article);
  }

  return result;
}
