/**
 * urlGuard — actually exercises the SSRF guard rather than grepping for it.
 * If this test passes, the server will refuse to fetch private/loopback URLs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { isPublicHttpUrl } from '../server/urlGuard.js';

describe('isPublicHttpUrl', () => {
  it('accepts public https URLs', () => {
    assert.equal(isPublicHttpUrl('https://example.com/feed.xml'), true);
    assert.equal(isPublicHttpUrl('https://news.bbc.co.uk/rss'), true);
  });

  it('accepts public http URLs', () => {
    assert.equal(isPublicHttpUrl('http://example.com'), true);
  });

  it('rejects non-http schemes', () => {
    assert.equal(isPublicHttpUrl('file:///etc/passwd'), false);
    assert.equal(isPublicHttpUrl('ftp://example.com'), false);
    assert.equal(isPublicHttpUrl('gopher://example.com'), false);
    assert.equal(isPublicHttpUrl('javascript:alert(1)'), false);
  });

  it('rejects loopback IPv4', () => {
    assert.equal(isPublicHttpUrl('http://127.0.0.1/'), false);
    assert.equal(isPublicHttpUrl('http://127.10.0.1/'), false);
    assert.equal(isPublicHttpUrl('http://localhost/'), false);
  });

  it('rejects RFC1918 private ranges', () => {
    assert.equal(isPublicHttpUrl('http://10.0.0.1/'), false);
    assert.equal(isPublicHttpUrl('http://172.16.5.4/'), false);
    assert.equal(isPublicHttpUrl('http://192.168.1.1/'), false);
  });

  it('rejects link-local / cloud metadata', () => {
    // 169.254.169.254 is the AWS/GCP metadata endpoint — must always be rejected.
    assert.equal(isPublicHttpUrl('http://169.254.169.254/latest/meta-data/'), false);
    assert.equal(isPublicHttpUrl('http://metadata.google.internal/'), false);
  });

  it('rejects internal DNS suffixes', () => {
    assert.equal(isPublicHttpUrl('http://service.local/'), false);
    assert.equal(isPublicHttpUrl('http://api.internal/'), false);
  });

  it('rejects loopback IPv6', () => {
    assert.equal(isPublicHttpUrl('http://[::1]/'), false);
    assert.equal(isPublicHttpUrl('http://[::]/'), false);
  });

  it('rejects unique-local + link-local IPv6', () => {
    assert.equal(isPublicHttpUrl('http://[fc00::1]/'), false);
    assert.equal(isPublicHttpUrl('http://[fd00::1]/'), false);
    assert.equal(isPublicHttpUrl('http://[fe80::1]/'), false);
  });

  it('rejects IPv4-mapped private ranges', () => {
    assert.equal(isPublicHttpUrl('http://[::ffff:127.0.0.1]/'), false);
    assert.equal(isPublicHttpUrl('http://[::ffff:10.0.0.1]/'), false);
  });

  it('rejects malformed URLs', () => {
    assert.equal(isPublicHttpUrl(''), false);
    assert.equal(isPublicHttpUrl(null), false);
    assert.equal(isPublicHttpUrl(undefined), false);
    assert.equal(isPublicHttpUrl('not a url'), false);
  });
});
