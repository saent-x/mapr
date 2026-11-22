import { XMLParser } from 'fast-xml-parser';
import { parseFeedDate } from './dates.js';
import { htmlToText, truncate } from './text.js';

export type FeedFormat = 'rss2' | 'atom' | 'rdf';

export interface ParsedItem {
  title: string;
  /** Absolute URL as found (not yet canonicalised). */
  link: string;
  publishedAt: Date | null;
  lead: string;
  bodyText: string;
}

export interface ParsedFeed {
  format: FeedFormat;
  title: string;
  lang: string | null;
  items: ParsedItem[];
}

export class FeedParseError extends Error {
  override name = 'FeedParseError';
}

export const LEAD_CHARS = 400;
export const BODY_CHARS = 20_000;
export const MAX_ITEMS = 300;

const ARRAY_TAGS = new Set(['item', 'entry', 'link', 'category', 'origLink']);

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  removeNSPrefix: true,
  textNodeName: '#text',
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  processEntities: true,
  htmlEntities: false, // HTML entities are decoded later by htmlToText
  isArray: (name) => ARRAY_TAGS.has(name),
});

type Node = Record<string, unknown>;

function txt(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) {
    for (const x of v) {
      const t = txt(x);
      if (t) return t;
    }
    return '';
  }
  if (typeof v === 'object') return txt((v as Node)['#text']);
  return '';
}

function first(...vals: unknown[]): string {
  for (const v of vals) {
    const t = txt(v).trim();
    if (t) return t;
  }
  return '';
}

function absolute(href: string, base: string | undefined): string | null {
  const h = href.trim();
  if (!h) return null;
  try {
    const u = base ? new URL(h, base) : new URL(h);
    return u.protocol === 'http:' || u.protocol === 'https:' ? u.href : null;
  } catch {
    return null;
  }
}

/** Atom-style <link href rel type>: prefer rel=alternate (or none) with an HTML type. */
function pickLinkHref(links: unknown): string {
  const arr = Array.isArray(links) ? links : links === undefined ? [] : [links];
  let fallback = '';
  for (const l of arr) {
    if (typeof l === 'string' && l.trim()) return l.trim();
    if (l && typeof l === 'object') {
      const n = l as Node;
      const href = txt(n['@_href']).trim() || txt(n['#text']).trim();
      if (!href) continue;
      const rel = txt(n['@_rel']).toLowerCase();
      const type = txt(n['@_type']).toLowerCase();
      if ((rel === '' || rel === 'alternate') && (type === '' || type.includes('html'))) return href;
      if (!fallback && rel !== 'self' && rel !== 'enclosure' && rel !== 'replies' && rel !== 'edit') fallback = href;
    }
  }
  return fallback;
}

function guidLink(guid: unknown): string {
  if (!guid) return '';
  const n = typeof guid === 'object' ? (guid as Node) : { '#text': guid };
  if (txt(n['@_isPermaLink']).toLowerCase() === 'false') return '';
  const t = txt(n).trim();
  return /^https?:\/\//i.test(t) ? t : '';
}

function makeItem(
  raw: { title: string; link: string; date: string; summary: string; content: string },
  base: string | undefined,
  now: Date,
): ParsedItem | null {
  const link = absolute(raw.link, base);
  if (!link) return null;
  const summaryText = htmlToText(raw.summary);
  const contentText = htmlToText(raw.content);
  let title = htmlToText(raw.title);
  const leadSrc = summaryText || contentText;
  if (!title) title = truncate(leadSrc, 140);
  if (!title) return null;
  return {
    title: truncate(title, 500),
    link,
    publishedAt: parseFeedDate(raw.date, now),
    lead: truncate(leadSrc, LEAD_CHARS),
    bodyText: truncate(contentText || summaryText, BODY_CHARS),
  };
}

function stripDoctype(xml: string): string {
  // Internal DTD subsets enable entity-expansion attacks and are never needed for feeds.
  return xml.replace(/<!DOCTYPE[^[>]*(\[[\s\S]*?\])?\s*>/gi, '');
}

/** Parse RSS 2.0 (and 0.9x), Atom 1.0 or RSS 1.0 (RDF). `feedUrl` resolves relative links. */
export function parseFeed(xml: string, feedUrl?: string, now: Date = new Date()): ParsedFeed {
  let doc: Node;
  try {
    doc = parser.parse(stripDoctype(xml)) as Node;
  } catch (err) {
    throw new FeedParseError(`invalid XML: ${(err as Error).message}`);
  }

  const rss = doc.rss as Node | undefined;
  const atom = doc.feed as Node | undefined;
  const rdf = doc.RDF as Node | undefined;

  if (rss && typeof rss === 'object') {
    const ch = (Array.isArray(rss.channel) ? rss.channel[0] : rss.channel) as Node | undefined;
    if (!ch) throw new FeedParseError('rss without channel');
    const items = ((ch.item as Node[] | undefined) ?? []).slice(0, MAX_ITEMS);
    return {
      format: 'rss2',
      title: htmlToText(first(ch.title)),
      lang: first(ch.language) || null,
      items: items
        .map((it) =>
          makeItem(
            {
              title: first(it.title),
              link: first(it.origLink) || pickLinkHref(it.link) || guidLink(it.guid),
              date: first(it.pubDate, it.date, it.published, it.updated),
              summary: first(it.description, it.summary),
              content: first(it.encoded, it.content),
            },
            feedUrl,
            now,
          ),
        )
        .filter((x): x is ParsedItem => x !== null),
    };
  }

  if (atom && typeof atom === 'object') {
    const base = absolute(txt(atom['@_base']), feedUrl) ?? feedUrl;
    const entries = ((atom.entry as Node[] | undefined) ?? []).slice(0, MAX_ITEMS);
    return {
      format: 'atom',
      title: htmlToText(first(atom.title)),
      lang: txt(atom['@_lang']) || null,
      items: entries
        .map((e) => {
          const eBase = absolute(txt(e['@_base']), base) ?? base;
          return makeItem(
            {
              title: first(e.title),
              link: first(e.origLink) || pickLinkHref(e.link) || guidLink(e.id),
              date: first(e.published, e.issued, e.updated, e.modified, e.date),
              summary: first(e.summary),
              content: first(e.content, e.encoded),
            },
            eBase,
            now,
          );
        })
        .filter((x): x is ParsedItem => x !== null),
    };
  }

  if (rdf && typeof rdf === 'object') {
    const ch = (Array.isArray(rdf.channel) ? rdf.channel[0] : rdf.channel) as Node | undefined;
    const items = ((rdf.item as Node[] | undefined) ?? []).slice(0, MAX_ITEMS);
    return {
      format: 'rdf',
      title: htmlToText(first(ch?.title)),
      lang: first(ch?.language) || null,
      items: items
        .map((it) =>
          makeItem(
            {
              title: first(it.title),
              link: first(it.link) || txt(it['@_about']),
              date: first(it.date, it.pubDate, it.issued, it.modified),
              summary: first(it.description),
              content: first(it.encoded),
            },
            feedUrl,
            now,
          ),
        )
        .filter((x): x is ParsedItem => x !== null),
    };
  }

  throw new FeedParseError('not an RSS, Atom or RDF document');
}
