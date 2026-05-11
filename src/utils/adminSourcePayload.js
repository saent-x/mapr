const GDELT_DOC_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';

function optionalString(value) {
  const text = String(value || '').trim();
  return text || undefined;
}

function withoutUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

export function buildGdeltSearchUrl(query) {
  const params = new URLSearchParams({
    query: String(query || '').trim(),
    mode: 'ArtList',
    format: 'json',
    maxrecords: '250',
    sort: 'DateDesc',
  });
  return `${GDELT_DOC_URL}?${params.toString()}`;
}

export function buildSourceAddPayload(form = {}, sourceKind = 'rss') {
  const name = optionalString(form.name);
  const country = optionalString(form.country);
  const notes = optionalString(form.notes);

  if (sourceKind === 'gdelt') {
    const gdeltQuery = optionalString(form.gdeltQuery);
    const url = optionalString(form.url) || buildGdeltSearchUrl(gdeltQuery);
    return withoutUndefined({
      name,
      url,
      country,
      sourceType: 'gdelt',
      fetchMode: 'gdelt',
      gdeltQuery,
      notes,
    });
  }

  return withoutUndefined({
    name,
    url: optionalString(form.url),
    country,
    sourceType: optionalString(form.sourceType) || 'rss',
    fetchMode: 'rss',
    notes,
  });
}
