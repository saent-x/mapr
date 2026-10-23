import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FeedParseError, parseFeed } from '../src/feeds/parse.js';
import { htmlToText, truncate } from '../src/feeds/text.js';
import { decodeBody, decompress } from '../src/net/fetcher.js';
import zlib from 'node:zlib';

const fx = (n: string) => readFileSync(new URL(`./fixtures/${n}`, import.meta.url), 'utf8');
const NOW = new Date('2026-10-23T12:00:00Z');

describe('RSS 2.0', () => {
  const f = parseFeed(fx('rss2.xml'), 'https://news.example.com/rss.xml', NOW);
  it('detects format, title and language', () => {
    expect(f.format).toBe('rss2');
    expect(f.title).toBe('Example World News');
    expect(f.lang).toBe('en-gb');
  });
  it('keeps items with a link and drops the rest', () => {
    expect(f.items.map((i) => i.link)).toEqual([
      'https://news.example.com/world/quake-1?utm_source=rss&utm_medium=feed',
      'https://news.example.com/world/relative-2',
      'https://news.example.com/world/guid-3',
      'https://news.example.com/world/future-4',
    ]);
  });
  it('strips HTML and decodes entities in title, lead and body', () => {
    const q = f.items[0]!;
    expect(q.title).toBe('Earthquake hits coastal region & cuts power');
    expect(q.lead).toBe('A magnitude 6.1 earthquake struck the coast early on Tuesday, officials said.');
    expect(q.bodyText).toBe('A magnitude 6.1 earthquake struck the coast early on Tuesday, officials said. Power was cut to 40,000 homes.');
    expect(q.bodyText).not.toContain('alert');
    expect(f.items[1]!.lead).toBe('Short summary with “curly quotes” and é.');
  });
  it('parses pubDate and dc:date, clamps the future', () => {
    expect(f.items[0]!.publishedAt?.toISOString()).toBe('2026-10-21T08:15:00.000Z');
    expect(f.items[1]!.publishedAt?.toISOString()).toBe('2026-10-21T07:00:00.000Z');
    expect(f.items[2]!.publishedAt?.toISOString()).toBe('2026-10-21T15:00:00.000Z');
    expect(f.items[3]!.publishedAt?.toISOString()).toBe(NOW.toISOString());
  });
});

describe('Atom', () => {
  const f = parseFeed(fx('atom.xml'), 'https://atom.example.org/feed', NOW);
  it('detects format and language', () => {
    expect(f.format).toBe('atom');
    expect(f.lang).toBe('fr');
    expect(f.title).toBe('Atom Example');
  });
  it('picks the alternate link, resolved against xml:base', () => {
    expect(f.items[0]!.link).toBe('https://atom.example.org/2026/10/floods-displace-thousands/');
    expect(f.items[1]!.link).toBe('https://atom.example.org/2026/10/updated-only');
  });
  it('uses summary for the lead and content for the body', () => {
    expect(f.items[0]!.title).toBe('Floods displace thousands');
    expect(f.items[0]!.lead).toBe('Heavy rain forced thousands from their homes.');
    expect(f.items[0]!.bodyText).toBe('Heavy rain forced thousands from their homes. Rivers burst their banks.');
  });
  it('prefers published, falls back to updated', () => {
    expect(f.items[0]!.publishedAt?.toISOString()).toBe('2026-10-21T11:00:00.000Z');
    expect(f.items[1]!.publishedAt?.toISOString()).toBe('2026-10-20T07:45:00.000Z');
  });
});

describe('RSS 1.0 / RDF', () => {
  const f = parseFeed(fx('rdf.xml'), 'https://rdf.example.net/rss', NOW);
  it('reads items that are siblings of the channel', () => {
    expect(f.format).toBe('rdf');
    expect(f.lang).toBe('en');
    expect(f.items).toHaveLength(2);
    expect(f.items[0]!.title).toBe('Election results announced in capital');
    expect(f.items[0]!.lead).toBe('Officials announced results after a delay.');
    expect(f.items[0]!.publishedAt?.toISOString()).toBe('2026-10-21T06:30:00.000Z');
    expect(f.items[1]!.title).toBe('Café strike enters second week');
    expect(f.items[1]!.publishedAt?.toISOString()).toBe('2026-10-21T03:00:00.000Z');
  });
});

describe('robustness', () => {
  it('rejects non-feed XML and broken XML', () => {
    expect(() => parseFeed('<html><body>hi</body></html>')).toThrow(FeedParseError);
    expect(() => parseFeed('<rss><channel><item><title>x</title></rss')).toThrow(FeedParseError);
  });
  it('ignores DOCTYPE entity definitions (no billion laughs)', () => {
    const xml = `<?xml version="1.0"?><!DOCTYPE rss [<!ENTITY a "aaaaaaaaaa"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;">]>
      <rss version="2.0"><channel><title>t</title><item><title>&b;</title><link>https://x.example/1</link></item></channel></rss>`;
    const f = parseFeed(xml);
    expect(f.items[0]!.title.length).toBeLessThan(20);
  });
  it('caps the lead at ~400 chars on a word boundary', () => {
    const long = Array.from({ length: 200 }, (_, i) => `word${i}`).join(' ');
    const f = parseFeed(`<rss version="2.0"><channel><item><title>t</title><link>https://x.example/1</link><description>${long}</description></item></channel></rss>`);
    expect(f.items[0]!.lead.length).toBeLessThanOrEqual(400);
    expect(f.items[0]!.lead.endsWith('word')).toBe(false);
    expect(f.items[0]!.bodyText).toBe(long);
  });
  it('uses the lead as title when the title is missing', () => {
    const f = parseFeed(`<rss version="2.0"><channel><item><link>https://x.example/1</link><description>Something happened</description></item></channel></rss>`);
    expect(f.items[0]!.title).toBe('Something happened');
  });
  it('prefers feedburner:origLink over the redirect link', () => {
    const f = parseFeed(`<rss version="2.0" xmlns:feedburner="http://rssnamespace.org/feedburner/ext/1.0"><channel><item><title>t</title><link>https://feeds.feedburner.com/~r/x/1</link><feedburner:origLink>https://real.example/a</feedburner:origLink></item></channel></rss>`);
    expect(f.items[0]!.link).toBe('https://real.example/a');
  });
});

describe('text helpers', () => {
  it('htmlToText handles double-escaped markup and whitespace', () => {
    expect(htmlToText('&lt;p&gt;Hello&amp;nbsp;&lt;b&gt;world&lt;/b&gt;&lt;/p&gt;')).toBe('Hello world');
    expect(htmlToText('<style>p{}</style><p>a</p>\n\n<p>b</p><!-- c -->')).toBe('a b');
  });
  it('truncate never splits a surrogate pair', () => {
    expect(Array.from(truncate('\u{1F600}'.repeat(10), 5))).toHaveLength(5);
  });
});

describe('body decoding', () => {
  it('honours the XML declaration charset', () => {
    const buf = Buffer.concat([Buffer.from('<?xml version="1.0" encoding="ISO-8859-1"?><x>Caf'), Buffer.from([0xe9]), Buffer.from('</x>')]);
    expect(decodeBody(buf)).toContain('Café');
  });
  it('lets the HTTP charset win and strips a UTF-8 BOM', () => {
    const buf = Buffer.from([0xef, 0xbb, 0xbf, ...Buffer.from('<x>é</x>')]);
    expect(decodeBody(buf, 'text/xml; charset=windows-1252')).toBe('<x>é</x>');
    expect(decodeBody(Buffer.from([0x3c, 0x78, 0x3e, 0xe9]), 'text/xml; charset=windows-1252')).toBe('<x>é');
  });
  it('decompresses gzip and enforces the cap after decompression', () => {
    const big = Buffer.alloc(2_000_000, 'a');
    const gz = zlib.gzipSync(big);
    expect(decompress(gz, 'gzip', 3_000_000).length).toBe(2_000_000);
    expect(() => decompress(gz, 'gzip', 1_000_000)).toThrow(/exceeds/);
  });
});
