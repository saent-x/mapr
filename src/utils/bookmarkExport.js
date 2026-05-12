function csvEscape(value) {
  if (value === null || value === undefined) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function isoOrEmpty(ts) {
  if (!ts) return '';
  const t = typeof ts === 'string' ? Date.parse(ts) : Number(ts);
  if (!Number.isFinite(t)) return '';
  return new Date(t).toISOString();
}

function downloadFile(filename, mime, content) {
  if (typeof window === 'undefined') return;
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function bookmarksToCSV(bookmarks = []) {
  const header = [
    'id', 'storyId', 'title', 'summary', 'source', 'url', 'region',
    'severity', 'status', 'priority', 'tags', 'note',
    'bookmarkedAt', 'updatedAt',
  ];
  const rows = [header.join(',')];
  for (const b of bookmarks) {
    const tags = Array.isArray(b.tags) ? b.tags.join('|') : '';
    rows.push([
      csvEscape(b.id),
      csvEscape(b.storyId),
      csvEscape(b.storyTitle),
      csvEscape(b.storySummary || ''),
      csvEscape(b.source || ''),
      csvEscape(b.url || ''),
      csvEscape(b.region || ''),
      csvEscape(b.severity ?? ''),
      csvEscape(b.status || ''),
      csvEscape(b.priority || ''),
      csvEscape(tags),
      csvEscape(b.note || ''),
      csvEscape(isoOrEmpty(b.bookmarkedAt)),
      csvEscape(isoOrEmpty(b.updatedAt)),
    ].join(','));
  }
  return rows.join('\n');
}

export function bookmarksToJSON(bookmarks = []) {
  return JSON.stringify(
    bookmarks.map((b) => ({
      id: b.id,
      storyId: b.storyId,
      title: b.storyTitle,
      summary: b.storySummary || '',
      source: b.source || '',
      url: b.url || '',
      region: b.region || '',
      severity: b.severity ?? null,
      status: b.status || '',
      priority: b.priority || '',
      tags: Array.isArray(b.tags) ? b.tags : [],
      note: b.note || '',
      bookmarkedAt: isoOrEmpty(b.bookmarkedAt),
      updatedAt: isoOrEmpty(b.updatedAt),
    })),
    null,
    2,
  );
}

export function exportBookmarksToCSV(bookmarks, filename = 'mapr-bookmarks.csv') {
  downloadFile(filename, 'text/csv;charset=utf-8', bookmarksToCSV(bookmarks));
}

export function exportBookmarksToJSON(bookmarks, filename = 'mapr-bookmarks.json') {
  downloadFile(filename, 'application/json;charset=utf-8', bookmarksToJSON(bookmarks));
}

// Parse comma- or space-separated tag input into a unique, lowercased array.
export function parseTagsInput(input) {
  if (!input) return [];
  return [...new Set(
    String(input)
      .split(/[,\n]+/)
      .map((t) => t.trim().toLowerCase().replace(/\s+/g, '-'))
      .filter(Boolean)
      .slice(0, 16),
  )];
}
