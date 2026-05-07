/**
 * formatDate.js — locale-aware date and number formatting utilities.
 *
 * Uses the currently active i18n language to produce locale-appropriate
 * date and number strings, ensuring the VAL-CROSS-034 contract:
 * - en: MM/DD/YYYY, 1,234.56
 * - fr: DD/MM/YYYY, 1 234,56
 * - ar: Arabic numerals, ١٬٢٣٤٫٥٦
 * - zh: YYYY/MM/DD, 1,234.56
 * - es: DD/MM/YYYY, 1.234,56
 */

/**
 * Maps an i18n language code (en/es/fr/ar/zh) to a BCP 47 locale code
 * suitable for Intl APIs.
 */
const LANG_TO_LOCALE = {
  en: 'en-US',
  es: 'es-ES',
  fr: 'fr-FR',
  ar: 'ar-SA',
  zh: 'zh-CN',
};

/**
 * Returns the BCP 47 locale for the given i18n language, or the
 * current active language via global i18n reference if no lang provided.
 * @param {string} [lang] - i18n language code (en/es/fr/ar/zh)
 * @returns {string} BCP 47 locale code
 */
export function getLocale(lang) {
  if (lang && LANG_TO_LOCALE[lang]) return LANG_TO_LOCALE[lang];
  // Fallback: try to read from localStorage or default to en-US
  try {
    const stored = typeof localStorage !== 'undefined' ? localStorage.getItem('mapr-lang') : null;
    return LANG_TO_LOCALE[stored] || 'en-US';
  } catch {
    return 'en-US';
  }
}

/**
 * Formats a Date or timestamp into a human-readable date string
 * respecting locale conventions.
 * en: 05/07/2026, fr: 07/05/2026, ar: ٠٧‏/٠٥‏/٢٠٢٦
 *
 * @param {Date|string|number} dateVal - value to format
 * @param {string} [lang] - i18n language code
 * @param {object} [options] - override Intl.DateTimeFormatOptions
 * @returns {string}
 */
export function formatDate(dateVal, lang, options) {
  if (!dateVal) return '—';
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    const locale = getLocale(lang);
    const opts = options || {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    };
    return d.toLocaleDateString(locale, opts);
  } catch {
    return String(dateVal);
  }
}

/**
 * Formats a Date or timestamp into a human-readable time string.
 *
 * @param {Date|string|number} dateVal
 * @param {string} [lang]
 * @param {object} [options]
 * @returns {string}
 */
export function formatTime(dateVal, lang, options) {
  if (!dateVal) return '—';
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    const locale = getLocale(lang);
    const opts = options || {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    };
    return d.toLocaleTimeString(locale, opts);
  } catch {
    return String(dateVal);
  }
}

/**
 * Formats a Date or timestamp into a combined date+time string.
 *
 * @param {Date|string|number} dateVal
 * @param {string} [lang]
 * @returns {string}
 */
export function formatDateTime(dateVal, lang) {
  if (!dateVal) return '—';
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    const locale = getLocale(lang);
    return d.toLocaleString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return String(dateVal);
  }
}

/**
 * Formats a number with locale-appropriate grouping and decimal separators.
 * en: 1,234.56, fr: 1 234,56, ar: ١٬٢٣٤٫٥٦
 *
 * @param {number} value
 * @param {string} [lang]
 * @param {object} [options] - Intl.NumberFormatOptions
 * @returns {string}
 */
export function formatNumber(value, lang, options) {
  if (value == null || Number.isNaN(value)) return '—';
  try {
    const locale = getLocale(lang);
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    return String(value);
  }
}

/**
 * Formats a Date into a short relative time description (e.g., "2 hours ago").
 * Uses Intl.RelativeTimeFormat when available, falls back to a simple
 * locale-aware format.
 *
 * @param {Date|string|number} dateVal
 * @param {string} [lang]
 * @returns {string}
 */
export function formatRelative(dateVal, lang) {
  if (!dateVal) return '—';
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    const locale = getLocale(lang);
    const now = Date.now();
    const diff = now - d.getTime();
    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (typeof Intl !== 'undefined' && Intl.RelativeTimeFormat) {
      const rtf = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
      if (days > 0) return rtf.format(-days, 'day');
      if (hours > 0) return rtf.format(-hours, 'hour');
      if (minutes > 0) return rtf.format(-minutes, 'minute');
      return rtf.format(-seconds, 'second');
    }

    // Fallback
    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return `${seconds}s ago`;
  } catch {
    return String(dateVal);
  }
}

/**
 * Formats a date as an ISO-like short string (YYYY-MM-DD HH:mm) using
 * locale-aware date parts. This keeps the YYYY-MM-DD format but uses
 * locale-appropriate numeric representation (especially for Arabic).
 *
 * @param {Date|string|number} dateVal
 * @param {string} [lang]
 * @returns {string}
 */
export function formatISOLike(dateVal, lang) {
  if (!dateVal) return '—';
  try {
    const d = dateVal instanceof Date ? dateVal : new Date(dateVal);
    if (Number.isNaN(d.getTime())) return String(dateVal);
    const locale = getLocale(lang);
    const datePart = d.toLocaleDateString(locale, {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const timePart = d.toLocaleTimeString(locale, {
      hour: '2-digit',
      minute: '2-digit',
    });
    return `${datePart} ${timePart}`;
  } catch {
    return String(dateVal);
  }
}
