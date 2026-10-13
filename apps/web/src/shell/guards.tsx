import { useEffect } from 'react';
import { Outlet } from 'react-router-dom';
import { useI18n } from '../i18n/I18nProvider';
import { usePrefs } from './local';
import { effectiveUiLanguage } from './preferences';

/** Applies the stored UI language preference once it is known; local switches are not overridden. */
export const PreferencesSync = () => {
  const { data: prefs } = usePrefs();
  const { language, setLanguage } = useI18n();
  const target = effectiveUiLanguage(prefs, language);
  useEffect(() => {
    if (target !== language) setLanguage(target);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target]);
  return null;
};

export const Shell = () => (
  <>
    <PreferencesSync />
    <Outlet />
  </>
);
