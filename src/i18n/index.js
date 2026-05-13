import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';

const SUPPORTED = new Set(['en', 'es', 'fr', 'ar', 'zh']);
const stored = (typeof localStorage !== 'undefined' && localStorage.getItem('mapr-lang')) || 'en';
const initialLang = SUPPORTED.has(stored) ? stored : 'en';

// Ship only English at startup. Other locales are loaded on demand via
// dynamic import — each is ~40-50 KB raw and was previously bundled into
// the eager entry chunk for every visitor regardless of language.
i18n.use(initReactI18next).init({
  resources: { en: { translation: en } },
  lng: initialLang,
  fallbackLng: 'en',
  interpolation: { escapeValue: false },
  // partialBundledLanguages tells i18next we'll fill in other locales later.
  partialBundledLanguages: true,
});

const localeLoaders = {
  es: () => import('./locales/es.json'),
  fr: () => import('./locales/fr.json'),
  ar: () => import('./locales/ar.json'),
  zh: () => import('./locales/zh.json'),
};

const loadedLocales = new Set(['en']);

export async function ensureLocale(lang) {
  if (!SUPPORTED.has(lang) || loadedLocales.has(lang)) return;
  const loader = localeLoaders[lang];
  if (!loader) return;
  try {
    const mod = await loader();
    i18n.addResourceBundle(lang, 'translation', mod.default || mod, true, true);
    loadedLocales.add(lang);
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn('[i18n] Failed to load locale', lang, err?.message);
  }
}

// Switch handler — caller invokes changeLanguage; we lazily load first.
const originalChange = i18n.changeLanguage.bind(i18n);
i18n.changeLanguage = async (lang, ...rest) => {
  await ensureLocale(lang);
  return originalChange(lang, ...rest);
};

// If the persisted/initial lang isn't English, kick off its load now.
if (initialLang !== 'en') {
  ensureLocale(initialLang).then(() => i18n.changeLanguage(initialLang));
}

export default i18n;
