import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

import en from './locales/en.json';
import es from './locales/es.json';
import fr from './locales/fr.json';
import ar from './locales/ar.json';
import zh from './locales/zh.json';

i18n.use(initReactI18next).init({
  resources: {
    en: { translation: en },
    es: { translation: es },
    fr: { translation: fr },
    ar: { translation: ar },
    zh: { translation: zh }
  },
  lng: localStorage.getItem('mapr-lang') || 'en',
  fallbackLng: 'en',
  interpolation: { escapeValue: false }
});

export default i18n;
