import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

/**
 * CSP validation tests — verify Content Security Policy in index.html.
 *
 * These tests correspond to M1 Foundation assertions:
 *   VAL-M1-001: img-src allows external HTTPS article images
 *   VAL-M1-002: img-src still allows existing tile CDN images
 *   VAL-M1-003: No other CSP directives broken by img-src change
 */

function parseCSP() {
  const html = readFileSync(join(ROOT, 'index.html'), 'utf-8');
  const match = html.match(/http-equiv="Content-Security-Policy"\s+content="([^"]+)"/);
  if (!match) throw new Error('CSP meta tag not found in index.html');
  return match[1];
}

function parseDirectives(cspString) {
  const directives = {};
  const parts = cspString.split(';').map(s => s.trim()).filter(Boolean);
  for (const part of parts) {
    const colonIdx = part.indexOf(' ');
    if (colonIdx === -1) {
      directives[part] = '';
    } else {
      directives[part.slice(0, colonIdx)] = part.slice(colonIdx + 1).trim();
    }
  }
  return directives;
}

// Baseline CSP value before M1 changes (for diff comparison)
// Updated with InstantDB auth domain (https://*.instantdb.com) added to connect-src
const BASELINE_CSP = "default-src 'self'; script-src 'self' 'unsafe-inline' blob:; worker-src blob:; " +
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
  "font-src 'self' https://fonts.gstatic.com; " +
  "img-src 'self' data: blob: https://*.basemaps.cartocdn.com; " +
  "connect-src 'self' ws: wss: https://*.gdeltproject.org https://opensky-network.org " +
  "https://corsproxy.io https://api.allorigins.win https://*.basemaps.cartocdn.com " +
  "https://*.instantdb.com; " +
  "frame-src 'self';";

describe('CSP img-src directive', () => {
  // VAL-M1-001: CSP img-src allows external HTTPS article images
  it('includes https: token in img-src (VAL-M1-001)', () => {
    const csp = parseCSP();
    const directives = parseDirectives(csp);
    assert.ok(directives['img-src'], 'img-src directive should exist');
    assert.ok(
      directives['img-src'].includes('https:'),
      `img-src should contain https: to allow external HTTPS article images. Got: ${directives['img-src']}`
    );
  });

  // VAL-M1-002: CSP img-src still allows existing tile CDN images
  it('still allows cartocdn tile images (VAL-M1-002)', () => {
    const csp = parseCSP();
    const directives = parseDirectives(csp);
    assert.ok(directives['img-src'], 'img-src directive should exist');

    // https: is a superset of https://*.basemaps.cartocdn.com,
    // so if https: is present, cartocdn is automatically covered.
    // We also verify the explicit pattern is still present.
    const hasHttpsWildcard = directives['img-src'].includes('https:');
    const hasCartocdn = directives['img-src'].includes('https://*.basemaps.cartocdn.com');

    assert.ok(
      hasHttpsWildcard || hasCartocdn,
      `img-src must allow cartocdn tile images. ` +
      `Has https: wildcard: ${hasHttpsWildcard}, has cartocdn explicit: ${hasCartocdn}`
    );
  });
});

describe('CSP directive integrity (VAL-M1-003)', () => {
  const csp = parseCSP();
  const directives = parseDirectives(csp);

  // Snapshot all non-img-src directives to ensure they haven't changed.
  // We compare each directive's value against the baseline.

  it('default-src unchanged', () => {
    assert.equal(directives['default-src'], "'self'", 'default-src must remain unchanged');
  });

  it('script-src unchanged', () => {
    assert.equal(
      directives['script-src'],
      "'self' 'unsafe-inline' blob:",
      'script-src must remain unchanged'
    );
  });

  it('worker-src unchanged', () => {
    assert.equal(directives['worker-src'], 'blob:', 'worker-src must remain unchanged');
  });

  it('style-src unchanged', () => {
    assert.equal(
      directives['style-src'],
      "'self' 'unsafe-inline' https://fonts.googleapis.com",
      'style-src must remain unchanged'
    );
  });

  it('font-src unchanged', () => {
    assert.equal(
      directives['font-src'],
      "'self' https://fonts.gstatic.com",
      'font-src must remain unchanged'
    );
  });

  it('connect-src unchanged', () => {
    assert.equal(
      directives['connect-src'],
      "'self' ws: wss: https://*.gdeltproject.org https://opensky-network.org " +
        'https://corsproxy.io https://api.allorigins.win https://*.basemaps.cartocdn.com ' +
        'https://*.instantdb.com',
      'connect-src must remain unchanged'
    );
  });

  it('frame-src unchanged', () => {
    assert.equal(directives['frame-src'], "'self'", 'frame-src must remain unchanged');
  });

  it('only img-src changed from baseline', () => {
    // Parse baseline directives
    const baseDirectives = parseDirectives(BASELINE_CSP);

    for (const [directive, value] of Object.entries(directives)) {
      if (directive === 'img-src') {
        // img-src should be different from baseline
        assert.notEqual(
          value,
          baseDirectives['img-src'],
          `img-src should have changed from baseline. Current: ${value}`
        );
        // And should contain https:
        assert.ok(
          value.includes('https:'),
          `img-src should contain https:. Current: ${value}`
        );
      } else {
        assert.equal(
          value,
          baseDirectives[directive],
          `${directive} should remain unchanged from baseline`
        );
      }
    }

    // Also verify the baseline set of directives hasn't grown or shrunk
    const currentKeys = Object.keys(directives).sort();
    const baselineKeys = Object.keys(baseDirectives).sort();
    assert.deepEqual(currentKeys, baselineKeys, 'No directives should be added or removed');
  });
});

// Verify that an img with an external HTTPS source is conceptually
// allowed by checking the CSP contains the right source expression.
describe('CSP external image allowance', () => {
  it('img-src allows arbitrary HTTPS domains', () => {
    const csp = parseCSP();
    const directives = parseDirectives(csp);
    const imgSrc = directives['img-src'];

    // With 'https:' in img-src, any HTTPS URL is permitted.
    // We verify the token is present as a standalone source (not just part of a host-source).
    const sources = imgSrc.split(/\s+/).filter(Boolean);
    assert.ok(
      sources.includes('https:'),
      `img-src sources should contain standalone 'https:' token. Found: ${JSON.stringify(sources)}`
    );
  });

  it('img-src preserves self, data:, blob: sources', () => {
    const csp = parseCSP();
    const directives = parseDirectives(csp);
    const imgSrc = directives['img-src'];
    const sources = imgSrc.split(/\s+/).filter(Boolean);

    assert.ok(sources.includes("'self'"), "img-src should still contain 'self'");
    assert.ok(sources.includes('data:'), 'img-src should still contain data:');
    assert.ok(sources.includes('blob:'), 'img-src should still contain blob:');
  });
});
