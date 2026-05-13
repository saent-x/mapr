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

/**
 * Boilerplate removal tags: elements whose content is stripped before
 * body extraction to avoid nav/footer/sidebar/ads contaminating results.
 */
const BOILERPLATE_TAGS = new Set([
  'nav', 'footer', 'header', 'aside', 'script', 'style', 'noscript',
  'iframe', 'form', 'figure', 'figcaption', 'button', 'select',
  'template', 'details', 'dialog'
]);

const BOILERPLATE_CLASS_PATTERNS = [
  /\bnav\b/i, /\bfooter\b/i, /\bsidebar\b/i, /\bmenu\b/i,
  /\bcomment/i, /\bad(s|vertisement)?\b/i, /\bsocial\b/i,
  /\bshare\b/i, /\bwidget\b/i, /\brelated\b/i, /\bsticky\b/i,
  /\bbanner\b/i, /\bpopup\b/i, /\bmodal\b/i, /\bcookie\b/i,
  /\btoolbar\b/i, /\bpagination\b/i, /\bbreadcrumb\b/i,
  /\bsubscribe\b/i, /\bnewsletter\b/i, /\bpromo\b/i,
  /\bstory\-?links\b/i, /\bauthor\-?bio\b/i, /\brecommend/i
];

const ARTICLE_CANDIDATE_TAGS = ['article', 'main', 'section', 'div'];

const ARTICLE_CANDIDATE_ROLES = ['main', 'article'];

function isBoilerplateByClass(className) {
  if (!className) return false;
  return BOILERPLATE_CLASS_PATTERNS.some((pattern) => pattern.test(className));
}

function isBoilerplateByRole(role) {
  if (!role) return false;
  const lowered = role.toLowerCase();
  return ['navigation', 'banner', 'contentinfo', 'complementary', 'search',
    'menubar', 'form', 'dialog', 'alert'].includes(lowered);
}

function stripBoilerplateElements(html) {
  // Remove all boilerplate tags and their content
  let cleaned = html;
  for (const tag of BOILERPLATE_TAGS) {
    cleaned = cleaned.replace(
      new RegExp(`<${tag}\\b[^>]*>[\\s\\S]*?<\\/${tag}>`, 'gi'),
      ' '
    );
  }

  // Remove elements with boilerplate class names or roles
  cleaned = cleaned.replace(
    /<(\w+)\b([^>]*)\bclass=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, beforeClass, className, afterClass, content) => {
      if (isBoilerplateByClass(className)) return ' ';
      return match;
    }
  );

  cleaned = cleaned.replace(
    /<(\w+)\b([^>]*)\brole=["']([^"']*)["']([^>]*)>([\s\S]*?)<\/\1>/gi,
    (match, tag, beforeRole, role, afterRole, content) => {
      if (isBoilerplateByRole(role)) return ' ';
      return match;
    }
  );

  return cleaned;
}

function findArticleContainer(html) {
  // Try <article> or <main> first
  const articleMatch = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i);
  if (articleMatch) return articleMatch[1];

  const mainMatch = html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i);
  if (mainMatch) return mainMatch[1];

  // Look for divs with content/article-related role, class, or id
  const candidatePattern = /<(\w+)\b([^>]*?)>([\s\S]*?)<\/\1>/gi;
  let bestMatch = null;
  let bestTextLength = 0;

  let match;
  while ((match = candidatePattern.exec(html)) !== null) {
    const attrs = match[2] || '';
    const content = match[3] || '';

    const roleMatch = attrs.match(/role=["']([^"']*)["']/i);
    const classMatch = attrs.match(/class=["']([^"']*)["']/i);
    const idMatch = attrs.match(/id=["']([^"']*)["']/i);

    const role = roleMatch?.[1]?.toLowerCase() || '';
    const className = classMatch?.[1]?.toLowerCase() || '';
    const id = idMatch?.[1]?.toLowerCase() || '';

    if (
      ARTICLE_CANDIDATE_ROLES.includes(role) ||
      /\b(article|content|post|story|entry|body\-content|main\-content)\b/i.test(className) ||
      /\b(article|content|post|story|entry|main)\b/i.test(id)
    ) {
      // Count words in text content as a quality heuristic
      const textOnly = stripTags(content);
      const wordCount = textOnly.split(/\s+/).filter(w => w.length > 2).length;

      if (wordCount > bestTextLength) {
        bestTextLength = wordCount;
        bestMatch = content;
      }
    }
  }

  return bestMatch || html;
}

function extractParagraphTexts(containerHtml) {
  // Extract text from <p> tags within the container
  const paragraphs = [];
  const pRegex = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;

  while ((match = pRegex.exec(containerHtml)) !== null) {
    const text = stripTags(match[1]);
    if (text.length > 20) {
      paragraphs.push(text);
    }
  }

  return paragraphs;
}

/**
 * Extract the article body text using readability-style heuristics.
 *
 * Strips nav, footer, header, aside, scripts, styles, and elements with
 * boilerplate class names or ARIA roles. Then attempts to locate the main
 * article content container and extracts paragraph text from it.
 *
 * @param {string} html - Raw HTML of the page
 * @returns {{ bodyText: string, paragraphs: string[], method: string }}
 *   bodyText is the full concatenated article text, paragraphs is the
 *   individual paragraph array, and method describes how the content was found.
 */
export function extractArticleBody(html) {
  if (!html) {
    return { bodyText: '', paragraphs: [], method: 'empty' };
  }

  // Step 1: Strip boilerplate elements
  const cleaned = stripBoilerplateElements(html);

  // Step 2: Find the article content container
  const container = findArticleContainer(cleaned);

  // Step 3: Extract paragraph texts
  const paragraphs = extractParagraphTexts(container);

  if (paragraphs.length === 0) {
    // Fallback: extract any remaining text
    const remainingText = stripTags(container);
    const trimmed = remainingText.replace(/\s+/g, ' ').trim();
    if (trimmed.length > 40) {
      return { bodyText: trimmed, paragraphs: [trimmed], method: 'fallback-text' };
    }
    return { bodyText: '', paragraphs: [], method: 'no-content' };
  }

  const bodyText = paragraphs.join('\n\n');

  const isContainer = container !== cleaned && container !== html;
  return {
    bodyText,
    paragraphs,
    method: isContainer ? 'article-container' : 'whole-page'
  };
}
