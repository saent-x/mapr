const HTML_ENTITY_MAP = {
  '&nbsp;': ' ',
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': '\'',
  '&#x27;': '\''
};

function decodeHtmlEntities(value) {
  return value.replace(/&(nbsp|amp|lt|gt|quot|#39|#x27);/gi, (match) => (
    HTML_ENTITY_MAP[match.toLowerCase()] || match
  ));
}

export function stripHtmlTags(value) {
  if (!value) {
    return '';
  }

  const rawValue = String(value);

  if (typeof DOMParser !== 'undefined') {
    try {
      const doc = new DOMParser().parseFromString(rawValue, 'text/html');
      return doc.body?.textContent || '';
    } catch {
      // Fall through to the regex-based fallback.
    }
  }

  return decodeHtmlEntities(rawValue.replace(/<[^>]*>/g, ' '));
}

export function normalizeArticleText(value) {
  return stripHtmlTags(value)
    .replace(/\s+/g, ' ')
    .trim();
}

export function getArticleTextPreview(value, maxLength = 220) {
  const normalized = normalizeArticleText(value);

  if (normalized.length <= maxLength) {
    return {
      text: normalized,
      truncated: false
    };
  }

  const preview = normalized
    .slice(0, maxLength)
    .replace(/\s+\S*$/, '')
    .trimEnd();

  return {
    text: `${preview}…`,
    truncated: true
  };
}
