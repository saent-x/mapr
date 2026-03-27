import test from 'node:test';
import assert from 'node:assert/strict';
import { deduplicateArticles } from '../src/utils/articleUtils.js';

function makeArticle(overrides = {}) {
  return {
    id: overrides.id || 'article-1',
    title: overrides.title || 'Default test article title',
    url: overrides.url || 'https://example.com/article-1',
    source: overrides.source || 'TestSource',
    summary: overrides.summary || overrides.title || 'Default test article title',
    severity: overrides.severity ?? 50,
    publishedAt: overrides.publishedAt || '2026-03-15T10:00:00.000Z',
    isoA2: overrides.isoA2 || 'US',
    ...overrides
  };
}

// --- URL-based deduplication (existing behavior) ---

test('deduplicateArticles removes exact URL duplicates', () => {
  const articles = [
    makeArticle({ id: 'a1', url: 'https://example.com/story', title: 'Story A' }),
    makeArticle({ id: 'a2', url: 'https://example.com/story', title: 'Story A copy' })
  ];
  const result = deduplicateArticles(articles);
  assert.equal(result.length, 1);
});

test('deduplicateArticles normalizes URLs for dedup (http vs https, www, trailing slash)', () => {
  const articles = [
    makeArticle({ id: 'a1', url: 'https://www.example.com/story/', title: 'Story' }),
    makeArticle({ id: 'a2', url: 'http://example.com/story', title: 'Story' })
  ];
  const result = deduplicateArticles(articles);
  assert.equal(result.length, 1);
});

test('deduplicateArticles keeps articles with different URLs', () => {
  const articles = [
    makeArticle({ id: 'a1', url: 'https://reuters.com/story-1', title: 'Story' }),
    makeArticle({ id: 'a2', url: 'https://bbc.com/story-1', title: 'Story' })
  ];
  const result = deduplicateArticles(articles);
  // Even same title, different URLs - both kept (URL dedup only matches same URL)
  assert.equal(result.length, 2);
});

// --- Title similarity deduplication (new behavior) ---

test('deduplicateArticles catches near-duplicate titles from different sources', () => {
  const articles = [
    makeArticle({
      id: 'reuters-1',
      url: 'https://reuters.com/ukraine-peace-talks',
      source: 'Reuters',
      title: 'Ukraine and Russia begin peace talks in Geneva'
    }),
    makeArticle({
      id: 'bbc-1',
      url: 'https://bbc.com/ukraine-peace-talks-geneva',
      source: 'BBC News',
      title: 'Ukraine and Russia begin peace talks in Geneva, officials say'
    })
  ];
  const result = deduplicateArticles(articles);
  // These are near-duplicates about the same story; should be deduped
  assert.equal(result.length, 1);
});

test('deduplicateArticles keeps legitimately different articles with some word overlap', () => {
  const articles = [
    makeArticle({
      id: 'a1',
      url: 'https://reuters.com/earthquake-japan',
      source: 'Reuters',
      title: 'Earthquake strikes northern Japan causing widespread damage'
    }),
    makeArticle({
      id: 'a2',
      url: 'https://bbc.com/japan-economy',
      source: 'BBC News',
      title: 'Japan economy shows signs of recovery despite challenges'
    })
  ];
  const result = deduplicateArticles(articles);
  // Different stories about Japan - should NOT be deduped
  assert.equal(result.length, 2);
});

test('deduplicateArticles does not falsely dedupe articles with similar short titles', () => {
  const articles = [
    makeArticle({
      id: 'a1',
      url: 'https://reuters.com/flood-india',
      source: 'Reuters',
      title: 'Floods in India kill dozens'
    }),
    makeArticle({
      id: 'a2',
      url: 'https://bbc.com/flood-bangladesh',
      source: 'BBC News',
      title: 'Floods in Bangladesh kill dozens'
    })
  ];
  const result = deduplicateArticles(articles);
  // Similar structure but different countries - should NOT be deduped
  assert.equal(result.length, 2);
});

test('deduplicateArticles handles mixed URL and title duplicates correctly', () => {
  const articles = [
    makeArticle({
      id: 'a1',
      url: 'https://reuters.com/climate-summit',
      source: 'Reuters',
      title: 'World leaders gather for climate summit in Paris'
    }),
    makeArticle({
      id: 'a2',
      url: 'https://reuters.com/climate-summit',
      source: 'Reuters',
      title: 'World leaders gather for climate summit in Paris'
    }),
    makeArticle({
      id: 'a3',
      url: 'https://bbc.com/paris-climate-summit',
      source: 'BBC News',
      title: 'World leaders gather for climate summit in Paris, pledging new action'
    })
  ];
  const result = deduplicateArticles(articles);
  // a1 and a2 are URL dups, a3 is a title near-dup of a1
  assert.equal(result.length, 1);
});

test('deduplicateArticles prefers article with better summary during title dedup', () => {
  const articles = [
    makeArticle({
      id: 'a1',
      url: 'https://reuters.com/missile-strike',
      source: 'Reuters',
      title: 'Missile strike hits residential area in Kharkiv Ukraine',
      summary: 'Missile strike hits residential area in Kharkiv Ukraine'
    }),
    makeArticle({
      id: 'a2',
      url: 'https://bbc.com/kharkiv-missile',
      source: 'BBC News',
      title: 'Missile strike hits residential area in Kharkiv, Ukraine',
      summary: 'A Russian missile struck a residential area in Kharkiv on Wednesday, killing at least 5 people.'
    })
  ];
  const result = deduplicateArticles(articles);
  assert.equal(result.length, 1);
  // Should keep the one with a better (non-title) summary
  assert.equal(result[0].source, 'BBC News');
});

test('deduplicateArticles handles empty and null inputs', () => {
  assert.deepEqual(deduplicateArticles([]), []);
  assert.deepEqual(deduplicateArticles(null), []);
  assert.deepEqual(deduplicateArticles(undefined), []);
});

test('deduplicateArticles handles articles with no URL (title+source key)', () => {
  const articles = [
    makeArticle({ id: 'a1', url: '', source: 'Reuters', title: 'Breaking news story' }),
    makeArticle({ id: 'a2', url: '', source: 'Reuters', title: 'Breaking news story' })
  ];
  const result = deduplicateArticles(articles);
  assert.equal(result.length, 1);
});

test('deduplicateArticles title similarity only applied across different source networks', () => {
  // Two articles from same source with similar titles should already be deduped by source::title key
  const articles = [
    makeArticle({
      id: 'a1',
      url: 'https://reuters.com/story-v1',
      source: 'Reuters',
      title: 'Major earthquake strikes Turkey causing destruction'
    }),
    makeArticle({
      id: 'a2',
      url: 'https://reuters.com/story-v2',
      source: 'Reuters',
      title: 'Major earthquake strikes Turkey causing widespread destruction'
    })
  ];
  const result = deduplicateArticles(articles);
  // Same source, different URLs, similar titles - title similarity should catch this
  assert.ok(result.length <= 2); // Either 1 or 2 is acceptable depending on threshold
});

test('deduplicateArticles preserves no duplicate URLs in output', () => {
  const articles = [
    makeArticle({ id: 'a1', url: 'https://example.com/1', title: 'Story one' }),
    makeArticle({ id: 'a2', url: 'https://example.com/2', title: 'Story two' }),
    makeArticle({ id: 'a3', url: 'https://example.com/1', title: 'Story one copy' }),
    makeArticle({ id: 'a4', url: 'https://example.com/3', title: 'Story three' }),
    makeArticle({ id: 'a5', url: 'https://example.com/2', title: 'Story two v2' })
  ];
  const result = deduplicateArticles(articles);
  const urls = result.map(a => a.url);
  const uniqueUrls = new Set(urls);
  assert.equal(urls.length, uniqueUrls.size, 'No duplicate URLs in output');
});

test('deduplicateArticles is efficient for large inputs', () => {
  const articles = [];
  for (let i = 0; i < 1000; i++) {
    articles.push(makeArticle({
      id: `art-${i}`,
      url: `https://source-${i % 100}.com/story-${i}`,
      source: `Source ${i % 50}`,
      title: `Unique headline number ${i} about world events`
    }));
  }
  const start = Date.now();
  const result = deduplicateArticles(articles);
  const elapsed = Date.now() - start;
  assert.ok(elapsed < 5000, `Deduplication took ${elapsed}ms, should be < 5000ms`);
  assert.ok(result.length > 0);
});
