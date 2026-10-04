import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import { ar } from './ar';
import { en } from './en';

export type Lang = 'ar' | 'en';
const KEY = 'hrms.lang';

const stored = (): Lang => {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'ar' || v === 'en') return v;
  } catch {
    /* التخزين قد يكون محجوباً */
  }
  return 'ar';
};

export const dirOf = (lang: Lang): 'rtl' | 'ltr' => (lang === 'ar' ? 'rtl' : 'ltr');

export const applyDocumentLang = (lang: Lang): void => {
  document.documentElement.lang = lang;
  document.documentElement.dir = dirOf(lang);
};

export const setLang = async (lang: Lang): Promise<void> => {
  try {
    localStorage.setItem(KEY, lang);
  } catch {
    /* تجاهل */
  }
  await i18n.changeLanguage(lang);
  applyDocumentLang(lang);
};

void i18n.use(initReactI18next).init({
  resources: { ar: { translation: ar }, en: { translation: en } },
  lng: stored(),
  fallbackLng: 'ar',
  interpolation: { escapeValue: false },
});
applyDocumentLang(stored());

export { i18n };
