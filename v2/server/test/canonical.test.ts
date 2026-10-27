import { describe, expect, it } from 'vitest';
import { canonicalUrl, isTrackingParam } from '../src/url/canonical.js';

describe('canonicalUrl', () => {
  it('lowercases scheme and host, keeps path case', () => {
    expect(canonicalUrl('HTTPS://News.Example.COM/World/Story')).toBe('https://news.example.com/World/Story');
  });
  it('drops fragments', () => {
    expect(canonicalUrl('https://a.example/x#comments')).toBe('https://a.example/x');
  });
  it('drops tracking params and sorts the rest', () => {
    expect(
      canonicalUrl('https://a.example/x?z=1&utm_source=rss&b=2&fbclid=abc&gclid=1&mc_cid=9&mc_eid=8&ref=home&a=3&UTM_Medium=x'),
    ).toBe('https://a.example/x?a=3&b=2&z=1');
  });
  it('removes the query entirely when only tracking params remain', () => {
    expect(canonicalUrl('https://a.example/x/?utm_campaign=c')).toBe('https://a.example/x');
  });
  it('keeps generic keys that can identify the article', () => {
    expect(canonicalUrl('https://a.example/view.php?id=42&cid=7')).toBe('https://a.example/view.php?cid=7&id=42');
  });
  it('strips default ports', () => {
    expect(canonicalUrl('http://a.example:80/x')).toBe('http://a.example/x');
    expect(canonicalUrl('https://a.example:443/x')).toBe('https://a.example/x');
    expect(canonicalUrl('https://a.example:8443/x')).toBe('https://a.example:8443/x');
  });
  it('strips trailing slash on non-root paths only', () => {
    expect(canonicalUrl('https://a.example/news/story/')).toBe('https://a.example/news/story');
    expect(canonicalUrl('https://a.example/')).toBe('https://a.example/');
    expect(canonicalUrl('https://a.example')).toBe('https://a.example/');
  });
  it('upgrades to https only when asked (feed served over https)', () => {
    expect(canonicalUrl('http://a.example/x')).toBe('http://a.example/x');
    expect(canonicalUrl('http://a.example/x', { preferHttps: true })).toBe('https://a.example/x');
    expect(canonicalUrl('http://a.example:80/x', { preferHttps: true })).toBe('https://a.example/x');
  });
  it('makes equivalent URLs identical', () => {
    const a = canonicalUrl('https://WWW.Example.com:443/a/b/?utm_source=x&q=1#top');
    const b = canonicalUrl('https://www.example.com/a/b?q=1&fbclid=zzz');
    expect(a).toBe(b);
  });
  it('rejects non-http schemes and garbage', () => {
    expect(canonicalUrl('ftp://a.example/x')).toBeNull();
    expect(canonicalUrl('javascript:alert(1)')).toBeNull();
    expect(canonicalUrl('not a url')).toBeNull();
  });
  it('drops credentials and collapses duplicate slashes', () => {
    expect(canonicalUrl('https://user:pw@a.example//x//y')).toBe('https://a.example/x/y');
  });
  it('knows tracking params', () => {
    for (const p of ['utm_source', 'utm_term', 'fbclid', 'gclid', 'mc_cid', 'ref', 'msclkid', 'at_medium']) {
      expect(isTrackingParam(p)).toBe(true);
    }
    for (const p of ['id', 'page', 'q', 'article']) expect(isTrackingParam(p)).toBe(false);
  });
});
