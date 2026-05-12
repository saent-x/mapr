import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = join(import.meta.dirname, '..');

function read(path) {
  return readFileSync(join(ROOT, path), 'utf8');
}

describe('security hardening regressions', () => {
  it('sensitive API routes do not use wildcard CORS', () => {
    const server = read('server/index.js');
    assert.match(server, /SENSITIVE_API_PREFIXES/);
    assert.match(server, /corsHeadersForPath/);
    assert.match(server, /'access-control-allow-methods': CORS_HEADERS\['access-control-allow-methods'\]/);
    assert.doesNotMatch(server, /'access-control-allow-origin': 'null'/);
    assert.match(server, /response\._maprPath = url\.pathname/);
    assert.match(server, /response\.writeHead\(204, corsHeadersForPath\(optionsUrl\.pathname\)\)/);
  });

  it('admin session cookie responses use path-aware CORS headers', () => {
    const server = read('server/index.js');
    assert.match(server, /sendJsonWithCookies\(response, 200, \{ ok: true \}, \[buildSetSessionCookie\(token, secure\)\], url\.pathname\)/);
    assert.match(server, /sendJsonWithCookies\(response, 200, \{ ok: true \}, \[buildClearSessionCookie\(secure\)\], url\.pathname\)/);
  });

  it('Stripe return URLs are constrained to APP_URL origin', () => {
    const stripe = read('server/stripe.js');
    assert.match(stripe, /function sameOriginReturnUrl/);
    assert.match(stripe, /candidate\.origin !== base\.origin/);
    assert.match(stripe, /success_url: safeSuccessUrl/);
    assert.match(stripe, /cancel_url: safeCancelUrl/);
    assert.match(stripe, /return_url: sameOriginReturnUrl\(returnUrl, '\/account\/billing'\)/);
  });
});
