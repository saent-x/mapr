/**
 * AI-powered severity classification + location inference using Transformers.js v3.
 *
 * Two models, both client-side, no API keys:
 * 1. Sentiment (DistilBERT, ~5MB q4) — severity scoring
 * 2. NER (DistilBERT-NER, ~65MB q8) — location entity extraction for misclassified articles
 */

import { geocodeArticle, countryToIso } from '../utils/geocoder';

const SENTIMENT_MODEL = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const NER_MODEL = 'Xenova/bert-base-NER';
const BATCH_SIZE = 32;
const MAX_ARTICLES = 500;
const TITLE_MAX_LEN = 100;

let classifierInstance = null;
let classifierPromise = null;
let nerInstance = null;
let nerPromise = null;

// In-memory caches (survive across data refreshes)
const scoreCache = new Map();
const nerCache = new Map(); // title hash → { region, isoA2, coordinates, locality } | null

function hashTitle(title) {
  const s = (title || '').toLowerCase().trim().slice(0, 80);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/* ── Sentiment classifier ── */

async function getClassifier() {
  if (classifierInstance) return classifierInstance;
  if (classifierPromise) return classifierPromise;

  classifierPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const c = await pipeline('sentiment-analysis', SENTIMENT_MODEL, { dtype: 'q4' });
    classifierInstance = c;
    return c;
  })();

  try { return await classifierPromise; }
  finally { classifierPromise = null; }
}

function sentimentToSeverity(label, score) {
  if (label === 'NEGATIVE') return Math.round(50 + score * 45);
  return Math.round(15 + (1 - score) * 30);
}

function prioritizeForClassification(articles) {
  const sorted = [...articles].sort((a, b) => {
    const aAmb = Math.abs(a.severity - 50);
    const bAmb = Math.abs(b.severity - 50);
    return aAmb - bAmb;
  });
  return sorted.slice(0, MAX_ARTICLES);
}

/* ── NER model for location inference ── */

async function getNerModel() {
  if (nerInstance) return nerInstance;
  if (nerPromise) return nerPromise;

  nerPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;
    const ner = await pipeline('token-classification', NER_MODEL, {
      dtype: 'q8',
    });
    nerInstance = ner;
    return ner;
  })();

  try { return await nerPromise; }
  finally { nerPromise = null; }
}

/**
 * Extract location entities from NER results.
 * NER returns tokens like B-LOC, I-LOC which we merge into full location names.
 */
function extractLocations(nerResults) {
  const locations = [];
  let current = '';

  for (const token of nerResults) {
    if (token.entity === 'B-LOC' || token.entity_group === 'LOC') {
      if (current) locations.push(current.trim());
      current = token.word;
    } else if (token.entity === 'I-LOC') {
      // Handle subword tokens (##prefix)
      if (token.word.startsWith('##')) {
        current += token.word.slice(2);
      } else {
        current += ' ' + token.word;
      }
    } else {
      if (current) locations.push(current.trim());
      current = '';
    }
  }
  if (current) locations.push(current.trim());

  return locations;
}

/**
 * Use NER to re-geocode articles that may be assigned to the wrong country.
 * Targets articles where locality === region (source-country fallback was used).
 *
 * @param {Array} articles - Articles to check
 * @param {Function} onProgress - Callback (processed, total)
 * @returns {Map<string, Object>} Map of articleId → { region, isoA2, coordinates, locality }
 */
export async function inferLocations(articles, onProgress) {
  // Only process articles that used the source-country fallback
  // (identified by locality === region, meaning no specific city/location was found)
  const candidates = articles.filter((a) => {
    if (nerCache.has(hashTitle(a.title))) return false;
    return a.locality === a.region; // Fallback indicator
  }).slice(0, 200); // Cap for performance

  const locationMap = new Map();

  if (candidates.length === 0) {
    if (onProgress) onProgress(0, 0);
    return locationMap;
  }

  const ner = await getNerModel();
  const total = candidates.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = candidates.slice(i, i + BATCH_SIZE);

    for (const article of batch) {
      const h = hashTitle(article.title);
      if (nerCache.has(h)) {
        const cached = nerCache.get(h);
        if (cached) locationMap.set(article.id, cached);
        continue;
      }

      try {
        const text = (article.title || '').slice(0, 150);
        const results = await ner(text, { ignore_labels: ['O'] });
        const locations = extractLocations(results);

        // Try to geocode each location entity until we find one
        let resolved = null;
        for (const loc of locations) {
          // Use geocodeArticle with the NER-extracted location as the "title"
          const geo = geocodeArticle(loc, null, '');
          if (geo) {
            const iso = countryToIso(geo.region);
            // Only update if the AI found a DIFFERENT country
            if (iso && iso !== article.isoA2) {
              resolved = {
                region: geo.region,
                isoA2: iso,
                coordinates: [geo.lat, geo.lng],
                locality: geo.locality,
              };
              break;
            }
          }
        }

        nerCache.set(h, resolved);
        if (resolved) locationMap.set(article.id, resolved);
      } catch (err) {
        console.warn('NER failed for article:', err.message);
        nerCache.set(h, null);
      }
    }

    if (onProgress) {
      onProgress(Math.min(i + BATCH_SIZE, total), total);
    }

    // Yield to main thread
    await new Promise((r) => setTimeout(r, 0));
  }

  return locationMap;
}

/**
 * Apply NER-inferred location corrections to articles.
 */
export function mergeAiLocations(articles, locationMap) {
  if (!locationMap || locationMap.size === 0) return articles;

  return articles.map((article) => {
    const loc = locationMap.get(article.id);
    if (!loc) return article;
    return {
      ...article,
      region: loc.region,
      isoA2: loc.isoA2,
      coordinates: loc.coordinates,
      locality: loc.locality,
    };
  });
}

/* ── Severity classification (unchanged) ── */

/**
 * Classify articles using AI sentiment analysis.
 */
export async function classifyArticles(articles, onProgress) {
  const toProcess = prioritizeForClassification(articles);

  const severityMap = new Map();
  const uncached = [];

  for (const article of toProcess) {
    const h = hashTitle(article.title);
    if (scoreCache.has(h)) {
      severityMap.set(article.id, scoreCache.get(h));
    } else {
      uncached.push(article);
    }
  }

  if (uncached.length === 0) {
    if (onProgress) onProgress(toProcess.length, toProcess.length);
    return severityMap;
  }

  const classifier = await getClassifier();
  const total = uncached.length;

  for (let i = 0; i < total; i += BATCH_SIZE) {
    const batch = uncached.slice(i, i + BATCH_SIZE);
    const titles = batch.map((a) => (a.title || '').slice(0, TITLE_MAX_LEN));

    try {
      const results = await classifier(titles);
      batch.forEach((article, idx) => {
        const { label, score } = results[idx];
        const severity = sentimentToSeverity(label, score);
        severityMap.set(article.id, severity);
        scoreCache.set(hashTitle(article.title), severity);
      });
    } catch (err) {
      console.warn('AI batch failed:', err.message);
    }

    if (onProgress) {
      const cached = toProcess.length - total;
      onProgress(cached + Math.min(i + BATCH_SIZE, total), toProcess.length);
    }

    await new Promise((r) => setTimeout(r, 0));
  }

  return severityMap;
}

/**
 * Merge AI severity scores with existing articles.
 * Uses weighted blend: 35% keyword-based + 65% AI-based.
 */
export function mergeAiSeverity(articles, severityMap) {
  return articles.map((article) => {
    const aiScore = severityMap.get(article.id);
    if (aiScore == null) return article;

    const blended = Math.round(article.severity * 0.35 + aiScore * 0.65);
    const finalSeverity = Math.max(10, Math.min(95, blended));

    if (finalSeverity === article.severity) return article;
    return { ...article, severity: finalSeverity };
  });
}
