// AFINN-165 sentiment lexicon — 3,382 English words scored from -5 (most negative) to +5 (most positive)
// Used as a lightweight alternative to ML-based sentiment analysis
// Source: https://github.com/fnielsen/afinn (ODbL license)
import { afinn165 as LEXICON } from 'afinn-165';

/**
 * Score a text string using the AFINN-165 lexicon.
 * Returns a value roughly in [-1, 1] representing sentiment polarity.
 * Negative = crisis/disaster language, Positive = constructive/hopeful language.
 */
export function scoreSentiment(text) {
  if (!text) return 0;

  const words = text
    .toLowerCase()
    .replace(/[^a-z\s'-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return 0;

  let total = 0;
  let matched = 0;

  for (const word of words) {
    const score = LEXICON[word];
    if (score !== undefined) {
      total += score;
      matched += 1;
    }
  }

  if (matched === 0) return 0;

  // Normalize: divide by sqrt of matched words to balance short vs long titles
  // Clamp to [-1, 1]
  const normalized = total / (Math.sqrt(matched) * 5);
  return Math.max(-1, Math.min(1, normalized));
}
