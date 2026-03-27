import { scoreSentiment } from './afinn.js';
import { computeCompositeSeverity } from './severityModel.js';

// Severity keywords — matched against article titles
const SEVERITY_KEYWORDS = {
  critical: [
    'killed', 'deaths', 'dead', 'massacre', 'bombing', 'explosion', 'earthquake',
    'tsunami', 'hurricane', 'cyclone', 'typhoon', 'famine', 'genocide', 'war ',
    'invasion', 'airstrike', 'missile', 'catastroph', 'devastat', 'collapse',
    'mass shooting', 'terror attack', 'nuclear', 'terremoto', 'séisme', 'sismo',
    'زلزال', '地震', 'inondation', 'inundaci', 'فيض', '洪水', 'incendie', 'انفجار', '爆炸'
  ],
  high: [
    'crisis', 'emergency', 'disaster', 'flood', 'wildfire', 'drought', 'epidemic',
    'outbreak', 'pandemic', 'conflict', 'attack', 'rebel', 'militant', 'refugee',
    'displacement', 'evacuati', 'casualt', 'injur', 'trapped', 'rescue',
    'severe', 'critical', 'urgent', 'siege', 'shelling', 'attaque', 'ataque',
    'guerre', 'guerra', 'هجوم', 'حرب', '袭击', '战争', 'évacu', 'evacuación',
    'إجلاء', '撤离', 'épid', 'epidemia', 'تفشي', '疫情'
  ],
  elevated: [
    'protest', 'unrest', 'tension', 'clashes', 'strike', 'riot', 'sanctions',
    'shortage', 'blackout', 'outage', 'landslide', 'storm', 'warning',
    'threat', 'arrest', 'detained', 'violence', 'corruption', 'coup',
    'inflation', 'recession', 'collapse', 'manifestation', 'protesta', 'احتجاج',
    '抗议', 'panne', 'apagón', 'انقطاع', '停电'
  ],
  moderate: [
    'concern', 'risk', 'dispute', 'debate', 'rally', 'march', 'demand',
    'investigation', 'allegation', 'scandal', 'controversy', 'delay',
    'disruption', 'closure', 'restriction', 'ban', 'retraso', 'retard', 'تحذير', '风险'
  ]
};

/**
 * Derive a severity score (0-100) from an article title.
 */
function stableOffset(input, max) {
  const text = (input || '').toLowerCase().trim();
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % max;
}

export function deriveSeverity(title, summary, entityContext) {
  const lower = (title || '').toLowerCase();
  const highVariance = stableOffset(lower, 10);
  const mediumVariance = stableOffset(lower, 15);
  const lowVariance = stableOffset(lower, 18);
  const baseVariance = stableOffset(lower, 15);

  // Phase 1: keyword match for base severity band
  let keywordBase = null;
  for (const keyword of SEVERITY_KEYWORDS.critical) {
    if (lower.includes(keyword)) { keywordBase = 85 + highVariance; break; }
  }
  if (keywordBase == null) {
    for (const keyword of SEVERITY_KEYWORDS.high) {
      if (lower.includes(keyword)) { keywordBase = 70 + mediumVariance; break; }
    }
  }
  if (keywordBase == null) {
    for (const keyword of SEVERITY_KEYWORDS.elevated) {
      if (lower.includes(keyword)) { keywordBase = 50 + lowVariance; break; }
    }
  }
  if (keywordBase == null) {
    for (const keyword of SEVERITY_KEYWORDS.moderate) {
      if (lower.includes(keyword)) { keywordBase = 35 + mediumVariance; break; }
    }
  }

  // Phase 2: AFINN sentiment boost (English titles only)
  const sentiment = scoreSentiment(title);
  // sentiment is [-1, 1]: -1 = very negative (high severity), +1 = very positive (low severity)
  const afinnBoost = Math.round(sentiment * -15); // range: [-15, +15]

  let keywordSeverity;
  if (keywordBase != null) {
    // Keyword matched: use AFINN to nudge within the band (±15 points)
    keywordSeverity = Math.max(10, Math.min(95, keywordBase + afinnBoost));
  } else {
    // No keyword match: use AFINN to differentiate from the baseline
    // Also check summary for sentiment if title is neutral
    const summarySentiment = summary ? scoreSentiment(summary) : 0;
    const combinedBoost = Math.round(((sentiment * 0.7) + (summarySentiment * 0.3)) * -15);
    keywordSeverity = Math.max(10, Math.min(95, 20 + baseVariance + combinedBoost));
  }

  // If entity context provided, use composite model
  if (entityContext) {
    return computeCompositeSeverity({
      keywordSeverity,
      articleCount: entityContext.articleCount || 1,
      diversityScore: entityContext.diversityScore || 0,
      entities: entityContext.entities || { organizations: [], people: [] },
      category: entityContext.category || 'General',
      isoA2: entityContext.isoA2 || null,
      regionalBaselineRatio: entityContext.regionalBaselineRatio || null
    });
  }

  // Otherwise return keyword-only result (backward compatible)
  return keywordSeverity;
}

/**
 * Derive a category from an article title.
 */
export function deriveCategory(title) {
  const lower = (title || '').toLowerCase();

  if (/earthquake|tsunami|volcano|eruption|seismic|aftershock|séisme|sismo|terremoto|زلزال|هزة|地震|余震/i.test(lower)) return 'Seismic';
  if (/flood|storm|hurricane|cyclone|typhoon|tornado|rain|snow|heat|cold|drought|wildfire|fire|inondation|inundaci|tormenta|incendie|فيض|عاصفة|إعصار|حرائق|洪水|台风|暴雨|山火/i.test(lower)) return 'Weather';
  if (/war |attack|bomb|missile|airstrike|military|army|rebel|militia|terror|guerre|attaque|ataque|guerra|ejército|هجوم|حرب|قصف|عسكري|袭击|战争|导弹/i.test(lower)) return 'Conflict';
  if (/protest|rally|march|riot|strike|demonstration|unrest|coup|manifestation|grève|protesta|huelga|احتجاج|مظاهرة|إضراب|抗议|示威/i.test(lower)) return 'Civil';
  if (/refugee|humanitarian|aid|famine|displacement|hunger|relief|réfugi|aide|desplaz|ayuda|hambre|لاجئ|نزوح|مساعدات|جوع|难民|人道|援助|饥荒|流离失所/i.test(lower)) return 'Humanitarian';
  if (/outbreak|pandemic|epidemic|virus|disease|health|hospital|vaccine|épid|maladie|santé|brote|epidemia|salud|لقاح|صحة|مستشفى|تفشي|疫情|疾病|医院|疫苗/i.test(lower)) return 'Health';
  if (/power|grid|infrastructure|bridge|road|pipeline|internet|outage|blackout|panne|coupure|réseau|apagón|infraestructura|انقطاع|كهرباء|شبكة|停电|电网|基础设施|断网/i.test(lower)) return 'Infrastructure';
  if (/climate|emission|pollution|deforestation|ocean|warming|carbon|climat|émission|contaminación|clima|مناخ|انبعاث|تلوث|气候|排放|污染/i.test(lower)) return 'Climate';
  if (/economy|inflation|recession|market|trade|gdp|unemployment|debt|économie|inflation|mercado|economía|اقتصاد|بطالة|通胀|经济/i.test(lower)) return 'Economic';
  if (/election|vote|parliament|president|minister|legislation|law|policy|élection|président|ministre|elección|presidente|ministro|انتخابات|رئيس|وزير|选举|总统|议会/i.test(lower)) return 'Political';

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

function normalizeUrl(url) {
  if (!url) return '';
  return url
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[?#].*$/, '')
    .replace(/\/$/, '');
}

// --- Title similarity helpers for cross-source deduplication ---

const DEDUP_STOP_WORDS = new Set([
  'the', 'and', 'for', 'with', 'from', 'that', 'this', 'into', 'near', 'amid',
  'after', 'before', 'over', 'under', 'across', 'new', 'says', 'say',
  'report', 'reports', 'news', 'update', 'updates', 'officials', 'official',
  'warns', 'warning', 'warn', 'region', 'state', 'province', 'continues',
  'continue', 'told', 'via', 'also', 'been', 'has', 'have', 'had', 'are',
  'were', 'was', 'will', 'can', 'could', 'would', 'should', 'may', 'about'
]);

/** Minimum Jaccard similarity to consider two titles as near-duplicates. */
const TITLE_SIMILARITY_THRESHOLD = 0.65;

/** Minimum meaningful token count for title comparison. */
const MIN_TOKENS_FOR_SIMILARITY = 3;

function tokenizeForDedup(title) {
  return (title || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .filter((token) => token.length > 2 && !DEDUP_STOP_WORDS.has(token));
}

function jaccardTokenSimilarity(leftTokens, rightTokens) {
  if (!leftTokens.length || !rightTokens.length) return 0;
  const right = new Set(rightTokens);
  let intersection = 0;
  for (const token of leftTokens) {
    if (right.has(token)) intersection++;
  }
  const union = new Set([...leftTokens, ...rightTokens]).size;
  return union === 0 ? 0 : intersection / union;
}

/**
 * Deduplicate articles using URL matching and title similarity.
 *
 * Phase 1: URL-based dedup (exact URL or source+title key).
 * Phase 2: Cross-source title similarity using Jaccard token overlap.
 *
 * When a duplicate is found, the version with the better (non-title) summary
 * is preferred.
 */
export function deduplicateArticles(articles) {
  if (!articles || !articles.length) return [];

  // Phase 1: URL-based and source+title key deduplication
  const seen = new Map();
  const urlDeduped = [];

  for (const article of articles) {
    const urlKey = normalizeUrl(article.url);
    const titleKey = normalizeTitle(article.title);
    const sourceKey = (article.source || 'unknown').toLowerCase().trim();
    const key = urlKey || `${sourceKey}::${titleKey}`;
    if (!key) continue;

    if (seen.has(key)) {
      const existing = seen.get(key);
      // Prefer the version with a real summary
      if (article.summary !== article.title && existing.summary === existing.title) {
        const idx = urlDeduped.indexOf(existing);
        if (idx !== -1) urlDeduped[idx] = article;
        seen.set(key, article);
      }
      continue;
    }
    seen.set(key, article);
    urlDeduped.push(article);
  }

  // Phase 2: Title-similarity deduplication across sources
  const result = [];
  const tokenCache = [];

  for (const article of urlDeduped) {
    const tokens = tokenizeForDedup(article.title);

    if (tokens.length >= MIN_TOKENS_FOR_SIMILARITY) {
      let bestMatchIdx = -1;
      let bestSimilarity = 0;

      for (let i = 0; i < result.length; i++) {
        if (tokenCache[i].length < MIN_TOKENS_FOR_SIMILARITY) continue;
        const similarity = jaccardTokenSimilarity(tokens, tokenCache[i]);
        if (similarity >= TITLE_SIMILARITY_THRESHOLD && similarity > bestSimilarity) {
          bestMatchIdx = i;
          bestSimilarity = similarity;
        }
      }

      if (bestMatchIdx >= 0) {
        // Near-duplicate found — prefer article with better summary
        const existing = result[bestMatchIdx];
        if (article.summary !== article.title && existing.summary === existing.title) {
          result[bestMatchIdx] = article;
          tokenCache[bestMatchIdx] = tokens;
        }
        continue;
      }
    }

    result.push(article);
    tokenCache.push(tokens);
  }

  return result;
}
