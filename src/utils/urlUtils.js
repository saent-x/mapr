export function getSourceHost(url, fallback = '') {
  if (!url) {
    return fallback;
  }

  try {
    const parsed = new URL(url);
    return parsed.hostname.replace(/^www\./, '') || fallback;
  } catch {
    return fallback;
  }
}
