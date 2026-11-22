import zlib from 'node:zlib';
import { MockAgent } from 'undici';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { fetchFeed, type FetchOptions } from '../src/net/fetcher.js';

let agent: MockAgent;
const publicResolver = async () => ['93.184.216.34'];
const opts = (o: Partial<FetchOptions> = {}): FetchOptions => ({
  timeoutMs: 2000,
  maxBytes: 1000,
  maxRedirects: 3,
  userAgent: 'test-agent',
  dispatcher: agent,
  resolver: publicResolver,
  ...o,
});

beforeEach(() => {
  agent = new MockAgent();
  agent.disableNetConnect();
});
afterEach(async () => {
  await agent.close();
});

describe('fetchFeed', () => {
  it('sends conditional headers and treats 304 as not modified', async () => {
    agent
      .get('https://feeds.example.com')
      .intercept({ path: '/rss', method: 'GET', headers: { 'if-none-match': '"abc"', 'if-modified-since': 'Tue, 21 Oct 2026 08:00:00 GMT', 'user-agent': 'test-agent' } })
      .reply(304, '', { headers: { etag: '"abc"' } });
    const r = await fetchFeed('https://feeds.example.com/rss', opts({ etag: '"abc"', lastModified: 'Tue, 21 Oct 2026 08:00:00 GMT' }));
    expect(r.notModified).toBe(true);
    expect(r.etag).toBe('"abc"');
  });
  it('decompresses gzip and returns validators', async () => {
    agent
      .get('https://feeds.example.com')
      .intercept({ path: '/rss' })
      .reply(200, zlib.gzipSync('<rss/>'), { headers: { 'content-encoding': 'gzip', etag: 'W/"1"', 'last-modified': 'x', 'content-type': 'application/rss+xml' } });
    const r = await fetchFeed('https://feeds.example.com/rss', opts());
    expect(r.body?.toString()).toBe('<rss/>');
    expect(r.etag).toBe('W/"1"');
    expect(r.contentType).toBe('application/rss+xml');
  });
  it('follows up to 3 redirects and reports the final url', async () => {
    const o = agent.get('https://a.example');
    o.intercept({ path: '/1' }).reply(301, '', { headers: { location: '/2' } });
    o.intercept({ path: '/2' }).reply(302, '', { headers: { location: 'https://a.example/3' } });
    o.intercept({ path: '/3' }).reply(307, '', { headers: { location: '/4' } });
    o.intercept({ path: '/4' }).reply(200, 'ok');
    const r = await fetchFeed('https://a.example/1', opts());
    expect(r.finalUrl).toBe('https://a.example/4');
    expect(r.body?.toString()).toBe('ok');
  });
  it('refuses a 4th redirect', async () => {
    const o = agent.get('https://a.example');
    for (let i = 1; i <= 4; i++) o.intercept({ path: `/${i}` }).reply(301, '', { headers: { location: `/${i + 1}` } });
    await expect(fetchFeed('https://a.example/1', opts())).rejects.toThrow(/more than 3 redirects/);
  });
  it('refuses redirects to private addresses, odd ports and other schemes', async () => {
    const o = agent.get('https://a.example');
    o.intercept({ path: '/meta' }).reply(302, '', { headers: { location: 'http://169.254.169.254/latest/meta-data' } });
    o.intercept({ path: '/port' }).reply(302, '', { headers: { location: 'http://a.example:6379/' } });
    o.intercept({ path: '/file' }).reply(302, '', { headers: { location: 'file:///etc/passwd' } });
    o.intercept({ path: '/v6' }).reply(302, '', { headers: { location: 'http://[::ffff:10.0.0.1]/' } });
    await expect(fetchFeed('https://a.example/meta', opts())).rejects.toThrow(/address not allowed/);
    await expect(fetchFeed('https://a.example/port', opts())).rejects.toThrow(/port not allowed/);
    await expect(fetchFeed('https://a.example/file', opts())).rejects.toThrow(/scheme not allowed/);
    await expect(fetchFeed('https://a.example/v6', opts())).rejects.toThrow(/address not allowed/);
  });
  it('refuses hosts that resolve to private addresses before connecting', async () => {
    await expect(fetchFeed('https://rebind.example/rss', opts({ resolver: async () => ['10.0.0.7'] }))).rejects.toThrow(/non-public/);
  });
  it('caps the body size', async () => {
    agent.get('https://a.example').intercept({ path: '/big' }).reply(200, 'x'.repeat(5000));
    await expect(fetchFeed('https://a.example/big', opts())).rejects.toThrow(/exceeds 1000 bytes/);
  });
  it('turns HTTP errors into FetchError with status', async () => {
    agent.get('https://a.example').intercept({ path: '/gone' }).reply(410, 'gone');
    await expect(fetchFeed('https://a.example/gone', opts())).rejects.toMatchObject({ name: 'FetchError', status: 410 });
  });
});
