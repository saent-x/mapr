/**
 * AI-powered severity classification using Transformers.js v3.
 * Runs a sentiment analysis model (DistilBERT) entirely in the browser.
 * Model downloads once (~5MB q4 quantized) and is cached by the browser.
 * No API keys, no server — fully client-side AI.
 */

const MODEL_ID = 'Xenova/distilbert-base-uncased-finetuned-sst-2-english';
const BATCH_SIZE = 32;
const MAX_ARTICLES = 500; // Cap to keep classification fast
const TITLE_MAX_LEN = 100; // Shorter = faster inference

let classifierInstance = null;
let loadingPromise = null;

// In-memory cache: title hash → severity score (survives across data refreshes)
const scoreCache = new Map();

function hashTitle(title) {
  const s = (title || '').toLowerCase().trim().slice(0, 80);
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = ((h << 5) - h + s.charCodeAt(i)) | 0;
  }
  return h;
}

/**
 * Lazy-load the sentiment analysis model via dynamic import.
 * Uses q4 quantization (~5MB) for fastest download and inference.
 */
async function getClassifier() {
  if (classifierInstance) return classifierInstance;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    const { pipeline, env } = await import('@huggingface/transformers');
    env.allowLocalModels = false;

    const classifier = await pipeline('sentiment-analysis', MODEL_ID, {
      dtype: 'q4', // ~5MB download, fastest inference
    });

    classifierInstance = classifier;
    return classifier;
  })();

  try {
    return await loadingPromise;
  } finally {
    loadingPromise = null;
  }
}

/**
 * Map sentiment analysis result to a severity score.
 */
function sentimentToSeverity(label, score) {
  if (label === 'NEGATIVE') {
    return Math.round(50 + score * 45); // 50-95
  }
  return Math.round(15 + (1 - score) * 30); // 15-45
}

/**
 * Prioritize articles that benefit most from AI classification.
 * Articles with ambiguous keyword severity (25-75) get priority.
 * Clearly critical (85+) or clearly low (<25) are fine with keywords.
 */
function prioritizeForClassification(articles) {
  const sorted = [...articles].sort((a, b) => {
    const aAmb = Math.abs(a.severity - 50);
    const bAmb = Math.abs(b.severity - 50);
    return aAmb - bAmb; // Most ambiguous first
  });
  return sorted.slice(0, MAX_ARTICLES);
}

/**
 * Classify articles using AI sentiment analysis.
 * Uses cached results when available, only runs inference on uncached titles.
 *
 * @param {Array} articles - Articles to classify
 * @param {Function} onProgress - Callback (processed, total)
 * @returns {Map<string, number>} Map of articleId → AI severity score
 */
export async function classifyArticles(articles, onProgress) {
  // Prioritize ambiguous articles, cap total
  const toProcess = prioritizeForClassification(articles);

  // Check cache first — resolve cached articles instantly
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

  // If everything was cached, we're done instantly
  if (uncached.length === 0) {
    if (onProgress) onProgress(toProcess.length, toProcess.length);
    return severityMap;
  }

  // Load model and classify uncached articles
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
        scoreCache.set(hashTitle(article.title), severity); // Cache it
      });
    } catch (err) {
      console.warn('AI batch failed:', err.message);
    }

    if (onProgress) {
      const cached = toProcess.length - total;
      onProgress(cached + Math.min(i + BATCH_SIZE, total), toProcess.length);
    }

    // Yield to main thread
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
