import { normalizeArticleText } from '../src/utils/articleText.js';

const ARTICLE_TYPES = new Set([
  'article',
  'newsarticle',
  'reportagenewsarticle',
  'analysisnewsarticle',
  'blogposting'
]);

function decodeHtmlEntities(value) {
  return String(value || '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&apos;|&#39;|&#x27;/gi, '\'');
}

function stripTags(value) {
  return normalizeArticleText(decodeHtmlEntities(String(value || '')));
}

function absolutizeUrl(baseUrl, value) {
  if (!value) {
    return '';
  }

  try {
    return new URL(String(value).trim(), baseUrl).toString();
  } catch {
    return '';
  }
}

function getHostName(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

function isProbablyArticleUrl(url, baseUrl) {
  if (!url) {
    return false;
  }

  const normalized = absolutizeUrl(baseUrl, url);
  if (!normalized) {
    return false;
  }

  try {
    const parsed = new URL(normalized);
    const base = new URL(baseUrl);
    const path = parsed.pathname || '/';

    if (!parsed.protocol.startsWith('http')) return false;
    if (parsed.hostname.replace(/^www\./, '') !== base.hostname.replace(/^www\./, '')) return false;
    if (path === '/' || path === '') return false;
    if (/\/(tag|tags|topic|topics|category|categories|author|authors|search)\b/i.test(path)) return false;
    if (/\.(xml|rss)$/i.test(path)) return false;
    return true;
  } catch {
    return false;
  }
}

function toTypeList(node) {
  const raw = node?.['@type'];
  return (Array.isArray(raw) ? raw : [raw])
    .filter(Boolean)
    .map((value) => String(value).toLowerCase());
}

function pickFirst(...values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }
  }

  return '';
}

function pickImage(value) {
  if (!value) {
    return null;
  }

  if (typeof value === 'string') {
    return value;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const picked = pickImage(item);
      if (picked) {
        return picked;
      }
    }
    return null;
  }

  if (typeof value === 'object') {
    return pickFirst(value.url, value.contentUrl, value['@id']);
  }

  return null;
}

function pickUrlFromNode(node) {
  return pickFirst(
    node?.url,
    node?.['@id'],
    typeof node?.mainEntityOfPage === 'string' ? node.mainEntityOfPage : '',
    node?.mainEntityOfPage?.url,
    node?.mainEntityOfPage?.['@id'],
    node?.item?.url,
    node?.item?.['@id']
  );
}

function normalizeJsonLdArticle(node, baseUrl) {
  const title = stripTags(pickFirst(node?.headline, node?.name, node?.alternativeHeadline));
  const url = absolutizeUrl(baseUrl, pickUrlFromNode(node));

  if (!title || !isProbablyArticleUrl(url, baseUrl)) {
    return null;
  }

  return {
    title,
    summary: stripTags(pickFirst(node?.description, node?.abstract)),
    link: url,
    publishedAt: pickFirst(node?.datePublished, node?.dateCreated, node?.dateModified),
    mediaUrl: absolutizeUrl(baseUrl, pickImage(node?.image) || '')
  };
}

function collectJsonLdNodes(node, results) {
  if (!node) {
    return;
  }

  if (Array.isArray(node)) {
    node.forEach((item) => collectJsonLdNodes(item, results));
    return;
  }

  if (typeof node !== 'object') {
    return;
  }

  const types = toTypeList(node);
  if (types.some((type) => ARTICLE_TYPES.has(type))) {
    results.push(node);
  }

  if (Array.isArray(node.itemListElement)) {
    node.itemListElement.forEach((item) => collectJsonLdNodes(item?.item || item, results));
  }

  if (node['@graph']) {
    collectJsonLdNodes(node['@graph'], results);
  }

  if (node.mainEntity) {
    collectJsonLdNodes(node.mainEntity, results);
  }

  if (node.hasPart) {
    collectJsonLdNodes(node.hasPart, results);
  }
}

function extractJsonLdArticles(html, baseUrl) {
  const scripts = [...String(html || '').matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)];
  const articles = [];

  scripts.forEach((match) => {
    const raw = String(match[1] || '').trim()
      .replace(/^<!--/, '')
      .replace(/-->$/, '')
      .trim();

    if (!raw) {
      return;
    }

    try {
      const parsed = JSON.parse(raw);
      const nodes = [];
      collectJsonLdNodes(parsed, nodes);
      nodes.forEach((node) => {
        const article = normalizeJsonLdArticle(node, baseUrl);
        if (article) {
          articles.push(article);
        }
      });
    } catch {
      // Ignore malformed JSON-LD blocks.
    }
  });

  return articles;
}

function extractAttr(block, attribute) {
  const match = String(block || '').match(new RegExp(`${attribute}=["']([^"']+)["']`, 'i'));
  return match?.[1] ? decodeHtmlEntities(match[1].trim()) : '';
}

function extractFirstTag(block, tagNames) {
  for (const tag of tagNames) {
    const match = String(block || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }

  return '';
}

function extractHref(block) {
  const match = String(block || '').match(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
  if (!match?.[1]) {
    return { url: '', text: '' };
  }

  return {
    url: decodeHtmlEntities(match[1].trim()),
    text: stripTags(match[2])
  };
}

function extractImage(block, baseUrl) {
  const srcset = extractAttr(block, 'srcset');
  if (srcset) {
    const first = srcset.split(',')[0]?.trim().split(/\s+/)[0];
    if (first) {
      return absolutizeUrl(baseUrl, first);
    }
  }

  const src = extractAttr(block, 'src');
  return src ? absolutizeUrl(baseUrl, src) : null;
}

function extractArticleBlocks(html, baseUrl) {
  const strippedHtml = String(html || '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ');
  const articleMatches = [...strippedHtml.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)];

  return articleMatches.map((match) => {
    const block = match[1];
    const anchor = extractHref(block);
    const title = extractFirstTag(block, ['h1', 'h2', 'h3', 'h4']) || anchor.text;
    const link = absolutizeUrl(baseUrl, anchor.url);
    const summary = extractFirstTag(block, ['p']);
    const publishedAt = extractAttr(block, 'datetime') || extractFirstTag(block, ['time']);
    const mediaUrl = extractImage(block, baseUrl);

    if (!title || !isProbablyArticleUrl(link, baseUrl)) {
      return null;
    }

    return {
      title,
      summary,
      link,
      publishedAt,
      mediaUrl
    };
  }).filter(Boolean);
}

function dedupeArticles(items) {
  const seen = new Set();

  return items.filter((item) => {
    const key = `${item.link}::${item.title}`;
    if (!item.title || !item.link || seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

export function parseHtmlSourceItems(html, baseUrl, { limit = 24 } = {}) {
  const jsonLdArticles = extractJsonLdArticles(html, baseUrl);
  const articleBlocks = extractArticleBlocks(html, baseUrl);
  const items = dedupeArticles([...jsonLdArticles, ...articleBlocks])
    .filter((item) => item.title.length >= 8)
    .slice(0, limit);

  return items.map((item) => ({
    ...item,
    sourceHost: getHostName(baseUrl)
  }));
}
