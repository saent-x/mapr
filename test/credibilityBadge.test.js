import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

/**
 * Tests for the source credibility indicator logic used on article cards.
 * The getCredibilityLevel function determines the credibility status of an event
 * based on independent source count and amplification detection.
 */

// Inline the logic to test independently of React components
function getCredibilityLevel(story) {
  if (story.amplification?.isAmplified) return 'amplified';
  if ((story.independentSourceCount || 0) >= 2) return 'corroborated';
  return 'single-source';
}

describe('getCredibilityLevel', () => {
  it('returns corroborated for events with 2+ independent sources', () => {
    const story = { independentSourceCount: 3, articleCount: 5 };
    assert.equal(getCredibilityLevel(story), 'corroborated');
  });

  it('returns corroborated for events with exactly 2 independent sources', () => {
    const story = { independentSourceCount: 2, articleCount: 2 };
    assert.equal(getCredibilityLevel(story), 'corroborated');
  });

  it('returns single-source for events with 1 source', () => {
    const story = { independentSourceCount: 1, articleCount: 1 };
    assert.equal(getCredibilityLevel(story), 'single-source');
  });

  it('returns single-source for events with no independentSourceCount', () => {
    const story = { articleCount: 1 };
    assert.equal(getCredibilityLevel(story), 'single-source');
  });

  it('returns single-source for events with independentSourceCount of 0', () => {
    const story = { independentSourceCount: 0, articleCount: 0 };
    assert.equal(getCredibilityLevel(story), 'single-source');
  });

  it('returns amplified when amplification is detected', () => {
    const story = {
      independentSourceCount: 1,
      articleCount: 5,
      amplification: { isAmplified: true, networkCount: 1, reason: 'test' }
    };
    assert.equal(getCredibilityLevel(story), 'amplified');
  });

  it('amplified takes priority over corroborated', () => {
    const story = {
      independentSourceCount: 3,
      articleCount: 6,
      amplification: { isAmplified: true, networkCount: 2, reason: 'test' }
    };
    assert.equal(getCredibilityLevel(story), 'amplified');
  });

  it('non-amplified events with many sources are corroborated', () => {
    const story = {
      independentSourceCount: 5,
      articleCount: 10,
      amplification: { isAmplified: false, networkCount: 5, reason: null }
    };
    assert.equal(getCredibilityLevel(story), 'corroborated');
  });

  it('handles missing amplification field gracefully', () => {
    const story = { independentSourceCount: 1 };
    assert.equal(getCredibilityLevel(story), 'single-source');
  });

  it('handles null amplification field gracefully', () => {
    const story = { independentSourceCount: 2, amplification: null };
    assert.equal(getCredibilityLevel(story), 'corroborated');
  });
});
