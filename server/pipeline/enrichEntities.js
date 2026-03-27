/**
 * Pipeline Stage 5: Entity Enrichment
 *
 * Runs Named Entity Recognition (NER) on article titles to extract
 * people, organizations, locations, and event categories.
 */

import { extractEntities } from '../entityExtractor.js';

/**
 * Enrich articles with named entity extraction.
 *
 * For each article that doesn't already have entities extracted,
 * runs NER on the title to identify people, organizations, locations,
 * and classify the event category.
 *
 * Mutates articles in-place for efficiency (avoids copying large arrays).
 *
 * @param {Array} articles - Articles to enrich
 * @returns {Promise<void>}
 */
export async function enrichArticlesWithEntities(articles) {
  for (const article of articles) {
    if (article.entities) {
      continue;
    }

    try {
      const extracted = await extractEntities(article.title);
      article.entities = extracted;
      if (extracted.category !== 'general') {
        article.nerCategory = extracted.category;
      }
    } catch {
      // Don't let one bad article crash the entire ingest
      article.entities = { people: [], organizations: [], locations: [], category: 'general' };
    }
  }
}
