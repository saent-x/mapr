function unwrapCdata(value) {
  return (value || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim();
}

function decodeXmlEntities(value) {
  return unwrapCdata(value)
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'");
}

function stripTags(value) {
  return decodeXmlEntities((value || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

function escapeTagName(tagName) {
  return tagName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function getFirstTagContent(block, tagNames) {
  for (const tagName of tagNames) {
    const escaped = escapeTagName(tagName);
    const regex = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)<\\/${escaped}>`, 'i');
    const match = block.match(regex);
    if (match?.[1]) {
      return stripTags(match[1]);
    }
  }

  return '';
}

function getFirstLink(block) {
  const atomMatch = block.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*\/?>/i);
  if (atomMatch?.[1]) {
    return decodeXmlEntities(atomMatch[1].trim());
  }

  const textMatch = block.match(/<link\b[^>]*>([\s\S]*?)<\/link>/i);
  if (textMatch?.[1]) {
    return stripTags(textMatch[1]);
  }

  return '';
}

function getMediaUrl(block) {
  const patterns = [
    /<media:content\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i,
    /<media:thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i,
    /<thumbnail\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i,
    /<enclosure\b[^>]*url=["']([^"']+)["'][^>]*\/?>/i
  ];

  for (const pattern of patterns) {
    const match = block.match(pattern);
    if (match?.[1]) {
      return decodeXmlEntities(match[1].trim());
    }
  }

  return null;
}

function getItemBlocks(xmlText) {
  const itemMatches = [...xmlText.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)];
  if (itemMatches.length > 0) {
    return itemMatches.map((match) => match[1]);
  }

  const entryMatches = [...xmlText.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];
  return entryMatches.map((match) => match[1]);
}

export function parseFeedItems(xmlText) {
  if (!xmlText || typeof xmlText !== 'string') {
    return [];
  }

  return getItemBlocks(xmlText)
    .map((block) => {
      const title = getFirstTagContent(block, ['title']);
      if (!title) {
        return null;
      }

      return {
        title,
        summary: getFirstTagContent(block, ['description', 'summary', 'content:encoded', 'content']),
        link: getFirstLink(block),
        publishedAt: getFirstTagContent(block, ['pubDate', 'published', 'updated']),
        mediaUrl: getMediaUrl(block)
      };
    })
    .filter(Boolean);
}
