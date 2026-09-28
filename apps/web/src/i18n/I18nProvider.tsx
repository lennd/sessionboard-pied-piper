import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';
import { detectLanguage, translate, type MessageKey, type UiLanguage } from './messages';

export const LANGUAGE_STORAGE_KEY = 'rdi.uiLanguage';

type I18nValue = {
  language: UiLanguage;
  setLanguage: (language: UiLanguage) => void;
  t: (key: MessageKey, params?: Record<string, string | number>) => string;
};

const I18nContext = createContext<I18nValue | null>(null);

const initial = (): UiLanguage =>
  detectLanguage(typeof localStorage === 'undefined' ? null : localStorage.getItem(LANGUAGE_STORAGE_KEY), typeof navigator === 'undefined' ? undefined : navigator.language);

export const I18nProvider = ({ children, initialLanguage }: { children: ReactNode; initialLanguage?: UiLanguage }) => {
  const [language, setLanguageState] = useState<UiLanguage>(initialLanguage ?? initial);

  const setLanguage = useCallback((next: UiLanguage) => {
    localStorage.setItem(LANGUAGE_STORAGE_KEY, next);
    document.documentElement.lang = next;
    setLanguageState(next);
  }, []);

  const value = useMemo<I18nValue>(
    () => ({ language, setLanguage, t: (key, params) => translate(language, key, params) }),
    [language, setLanguage],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export const useI18n = (): I18nValue => {
  const value = useContext(I18nContext);
  if (!value) throw new Error('useI18n must be used inside <I18nProvider>');
  return value;
};
