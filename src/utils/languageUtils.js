const LANGUAGE_MARKERS = {
  en: [' the ', ' and ', ' with ', ' from ', ' after ', ' over ', ' into ', ' of ', ' for '],
  es: [' el ', ' la ', ' los ', ' las ', ' una ', ' para ', ' con ', ' desde ', ' tras '],
  fr: [' le ', ' la ', ' les ', ' une ', ' des ', ' avec ', ' dans ', ' après ', ' pour ']
};

const SCRIPT_PATTERNS = {
  ar: /[\u0600-\u06ff]/,
  zh: /[\u3400-\u4dbf\u4e00-\u9fff\uf900-\ufaff]/
};

function scoreMarkers(sample, markers) {
  return markers.reduce((score, marker) => (
    sample.includes(marker) ? score + 1 : score
  ), 0);
}

export function detectLanguage(text, hint = null) {
  if (hint && hint !== 'auto' && hint !== 'unknown') {
    return hint;
  }

  const sample = ` ${(text || '').trim().toLowerCase()} `;
  if (!sample.trim()) {
    return hint || 'unknown';
  }

  if (SCRIPT_PATTERNS.ar.test(sample)) {
    return 'ar';
  }

  if (SCRIPT_PATTERNS.zh.test(sample)) {
    return 'zh';
  }

  const scores = Object.fromEntries(
    Object.entries(LANGUAGE_MARKERS).map(([lang, markers]) => [lang, scoreMarkers(sample, markers)])
  );

  const [bestLanguage, bestScore] = Object.entries(scores)
    .sort((left, right) => right[1] - left[1])[0];

  if (bestScore >= 2) {
    return bestLanguage;
  }

  if (/^[\x00-\x7f\s]+$/.test(sample)) {
    return scores.en >= 1 ? 'en' : 'unknown';
  }

  return 'unknown';
}

export function isEnglishLike(text, hint = null) {
  const detected = detectLanguage(text, hint);
  if (detected === 'en') {
    return true;
  }

  if (detected !== 'unknown') {
    return false;
  }

  return /^[\x00-\x7f\s]+$/.test(text || '');
}

export function shouldUseEnglishModels(article) {
  const sample = [article?.title, article?.summary].filter(Boolean).join(' ');
  return isEnglishLike(sample, article?.language);
}
