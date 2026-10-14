import { LEVELS, type Level } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { Segmented } from '../components/Segmented';
import { useUpdatePrefs } from '../local';
import { useSettingsContext } from './SettingsLayout';

export const PreferencesPage = () => {
  const { t, language } = useI18n();
  const { prefs } = useSettingsContext();
  const updatePrefs = useUpdatePrefs();
  const withDefault = <T extends string>(values: readonly T[], label: (v: T) => string, defaultValue: string) => [
    { value: null, label: t('prefs.default', { value: defaultValue }) },
    ...values.map((v) => ({ value: v, label: label(v) })),
  ];

  return (
    <section>
      <h1>{t('prefs.title')}</h1>
      <p className="shell-sub">{t('prefs.subtitle')}</p>
      <div className="field"><span className="field-label">{t('prefs.uiLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-ui" value={prefs.uiLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${language}`))} onChange={(uiLanguage) => updatePrefs.mutate({ uiLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.explanationLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-explanation" value={prefs.explanationLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${prefs.uiLanguage ?? language}`))} onChange={(explanationLanguage) => updatePrefs.mutate({ explanationLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.theme')}</span>
        <Segmented<ThemeId | null> testid="pref-theme" value={prefs.theme} options={withDefault(THEMES, (th) => t(`theme.${th}`), t('theme.piper'))} onChange={(theme) => updatePrefs.mutate({ theme })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.level')}</span>
        <Segmented<Level | null> testid="pref-level" value={prefs.initialLevel} options={withDefault(LEVELS, (l) => t(`level.${l}`), t('level.architecture'))} onChange={(initialLevel) => updatePrefs.mutate({ initialLevel })} />
      </div>
    </section>
  );
};
