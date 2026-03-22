const OFFICIAL_SOURCE_HINTS = [
  '.gov', '.mil', '.int', '.un.org', 'reliefweb', 'who.', 'wmo.', 'emsc', 'usgs'
];

const WIRE_SOURCE_HINTS = [
  'reuters', 'associated press', 'ap news', 'apnews', 'afp', 'bloomberg'
];

const GLOBAL_SOURCE_HINTS = [
  'bbc', 'al jazeera', 'guardian', 'dw', 'france24', 'euronews', 'npr', 'abc news'
];

const SOURCE_NETWORK_HINTS = [
  { key: 'reuters', hints: ['reuters'] },
  { key: 'ap', hints: ['associated press', 'ap news', 'apnews'] },
  { key: 'afp', hints: ['afp', 'agence france-presse'] },
  { key: 'bloomberg', hints: ['bloomberg'] },
  { key: 'bbc', hints: ['bbc'] },
  { key: 'al-jazeera', hints: ['al jazeera', 'aljazeera'] },
  { key: 'guardian', hints: ['guardian'] },
  { key: 'dw', hints: ['dw', 'deutsche welle'] },
  { key: 'france24', hints: ['france24', 'france 24'] },
  { key: 'euronews', hints: ['euronews'] },
  { key: 'npr', hints: ['npr'] },
  { key: 'abc-news', hints: ['abc news'] },
  { key: 'reliefweb', hints: ['reliefweb'] },
  { key: 'who', hints: ['who.', 'world health organization'] },
  { key: 'wmo', hints: ['wmo.', 'world meteorological organization'] },
  { key: 'usgs', hints: ['usgs'] },
  { key: 'emsc', hints: ['emsc'] },
  { key: 'russian-state-media', hints: ['tass', 'sputnik', 'rt.com', 'ria novosti', 'ria-novosti', 'rossiya', 'interfax'] }
];

function normalizeSourceName(source) {
  return (source || '').toLowerCase().trim();
}

function normalizeSourceKey(value) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function getSourceHost(url) {
  if (!url) {
    return '';
  }

  try {
    return new URL(url).hostname
      .toLowerCase()
      .replace(/^www\./, '')
      .replace(/^m\./, '');
  } catch {
    return '';
  }
}

export function classifySourceType({ source, sourceType, sourceCountry }) {
  if (sourceType) {
    return sourceType;
  }

  const normalized = normalizeSourceName(source);

  if (OFFICIAL_SOURCE_HINTS.some((hint) => normalized.includes(hint))) {
    return 'official';
  }

  if (WIRE_SOURCE_HINTS.some((hint) => normalized.includes(hint))) {
    return 'wire';
  }

  if (GLOBAL_SOURCE_HINTS.some((hint) => normalized.includes(hint))) {
    return 'global';
  }

  if (sourceCountry) {
    return 'regional';
  }

  return 'unknown';
}

export function getSourceNetworkKey({ source, sourceType, sourceCountry, url }) {
  const normalizedSource = normalizeSourceName(source);
  const host = getSourceHost(url);
  const combined = `${normalizedSource} ${host}`.trim();

  const matchedNetwork = SOURCE_NETWORK_HINTS.find(({ hints }) => (
    hints.some((hint) => combined.includes(hint))
  ));

  if (matchedNetwork) {
    return matchedNetwork.key;
  }

  if (host) {
    return normalizeSourceKey(host);
  }

  if (normalizedSource) {
    return normalizeSourceKey(normalizedSource);
  }

  if (sourceCountry) {
    return `country-${sourceCountry.toLowerCase()}`;
  }

  return `type-${classifySourceType({ source, sourceType, sourceCountry })}`;
}

export function getDynamicTrustScore(staticScore, credibilityRecord) {
  if (!credibilityRecord || credibilityRecord.totalEvents < 5) {
    return staticScore; // Not enough history
  }
  const corroborationRate = credibilityRecord.corroboratedEvents / credibilityRecord.totalEvents;
  return staticScore * 0.6 + corroborationRate * 0.4;
}

export function getSourceTrustScore(sourceMeta) {
  const sourceType = classifySourceType(sourceMeta);

  switch (sourceType) {
    case 'official':
      return 1;
    case 'wire':
      return 0.94;
    case 'global':
      return 0.86;
    case 'regional':
      return 0.78;
    case 'local':
      return 0.72;
    default:
      return 0.6;
  }
}
