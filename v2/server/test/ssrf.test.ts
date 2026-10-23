import { describe, expect, it } from 'vitest';
import { assertPublicUrl, checkUrl, expandIPv6, isBlockedIp, SsrfError, guardedLookup } from '../src/net/ssrf.js';

describe('isBlockedIp', () => {
  it.each([
    '127.0.0.1', '127.255.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254',
    '100.64.0.1', '100.127.255.255', '0.0.0.0', '224.0.0.1', '239.255.255.250', '255.255.255.255', '198.18.0.1',
    '192.0.2.1', '::1', '::', 'fe80::1', 'febf::1', 'fc00::1', 'fd12:3456::1', 'ff02::1', '::ffff:127.0.0.1',
    '::ffff:10.0.0.1', '::ffff:7f00:1', '64:ff9b::a00:1', '2001:db8::1', '2002:7f00:1::1', 'fec0::1', '::127.0.0.1',
  ])('blocks %s', (ip) => expect(isBlockedIp(ip)).toBe(true));

  it.each(['8.8.8.8', '1.1.1.1', '172.15.0.1', '172.32.0.1', '100.63.255.255', '100.128.0.1', '151.101.1.140',
    '2606:4700::1111', '2a00:1450:4001::200e', '::ffff:8.8.8.8', '64:ff9b::808:808'])(
    'allows %s', (ip) => expect(isBlockedIp(ip)).toBe(false),
  );

  it('blocks non-IPs', () => expect(isBlockedIp('example.com')).toBe(true));
});

describe('expandIPv6', () => {
  it('expands compressed forms and embedded IPv4', () => {
    expect(expandIPv6('::1')).toEqual([0, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('::ffff:1.2.3.4')).toEqual([0, 0, 0, 0, 0, 0xffff, 0x0102, 0x0304]);
    expect(expandIPv6('fe80::1%eth0')).toEqual([0xfe80, 0, 0, 0, 0, 0, 0, 1]);
    expect(expandIPv6('nope')).toBeNull();
  });
});

describe('checkUrl', () => {
  it('allows public http(s) on default ports', () => {
    expect(checkUrl('https://feeds.bbci.co.uk/news/world/rss.xml').hostname).toBe('feeds.bbci.co.uk');
    expect(checkUrl('http://example.com:80/x').hostname).toBe('example.com');
    expect(checkUrl('https://example.com:443/x').hostname).toBe('example.com');
  });
  it.each([
    'file:///etc/passwd', 'ftp://example.com/x', 'gopher://example.com/', 'javascript:alert(1)', 'data:text/plain,hi',
    'http://example.com:8080/', 'https://example.com:22/', 'http://user:pw@example.com/', 'http://localhost/',
    'http://LOCALHOST./', 'http://foo.localhost/', 'http://printer.local/', 'http://metadata.google.internal/',
    'http://intranet/', 'http://127.0.0.1/', 'http://[::1]/', 'http://[::ffff:127.0.0.1]/', 'http://169.254.169.254/latest',
    'http://0x7f000001/', 'http://2130706433/', 'http://017700000001/', 'http://10.0.0.1/', 'http://[fd00::1]/',
    'http://100.64.1.1/', 'https://mapr.stbrn.studio/', 'not a url',
  ])('rejects %s', (u) => expect(() => checkUrl(u)).toThrow(SsrfError));
});

describe('assertPublicUrl', () => {
  const resolver = (map: Record<string, string[]>) => async (h: string) => map[h] ?? [];
  it('accepts hosts that resolve only to public addresses', async () => {
    await expect(assertPublicUrl('https://news.example.com/x', resolver({ 'news.example.com': ['93.184.216.34', '2606:2800:220:1::1'] }))).resolves.toBeInstanceOf(URL);
  });
  it('rejects hosts with any private answer (DNS rebinding)', async () => {
    await expect(assertPublicUrl('https://evil.example/x', resolver({ 'evil.example': ['93.184.216.34', '127.0.0.1'] }))).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl('https://evil6.example/x', resolver({ 'evil6.example': ['fd00::5'] }))).rejects.toThrow(/non-public/);
    await expect(assertPublicUrl('https://cgnat.example/x', resolver({ 'cgnat.example': ['100.100.100.100'] }))).rejects.toThrow(/non-public/);
  });
  it('rejects hosts with no answer or failing DNS', async () => {
    await expect(assertPublicUrl('https://none.example/x', resolver({}))).rejects.toThrow(/no addresses/);
    await expect(assertPublicUrl('https://x.example/', async () => { throw new Error('ENOTFOUND'); })).rejects.toThrow(/dns lookup failed/);
  });
});

describe('guardedLookup', () => {
  it('refuses blocked names without resolving', async () => {
    const err = await new Promise<Error | null>((res) => guardedLookup('localhost', {}, (e) => res(e)));
    expect(err).toBeInstanceOf(SsrfError);
  });
  it('refuses loopback answers from the resolver, with and without all:true', async () => {
    for (const all of [false, true]) {
      const err = await new Promise<Error | null>((res) => guardedLookup('127.0.0.1', { all }, (e) => res(e)));
      expect(err?.message).toMatch(/non-public/);
    }
  });
});
