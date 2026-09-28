import { LEVELS, type Level } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { Segmented } from '../components/Segmented';
import { useUpdateMe } from '../session';
import { useSettingsContext } from './SettingsLayout';

export const PreferencesPage = () => {
  const { t } = useI18n();
  const { org, session } = useSettingsContext();
  const updateMe = useUpdateMe();
  const { user } = session;
  const withDefault = <T extends string>(values: readonly T[], label: (v: T) => string, orgValue: string) => [
    { value: null, label: t('prefs.orgDefault', { value: orgValue }) },
    ...values.map((v) => ({ value: v, label: label(v) })),
  ];

  return (
    <section>
      <h1>{t('prefs.title')}</h1>
      <p className="shell-sub">{t('prefs.subtitle')}</p>
      <div className="field"><span className="field-label">{t('prefs.uiLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-ui" value={user.uiLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${org.defaultUiLanguage}`))} onChange={(uiLanguage) => updateMe.mutate({ uiLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.explanationLanguage')}</span>
        <Segmented<UiLanguage | null> testid="pref-explanation" value={user.explanationLanguage} options={withDefault(UI_LANGUAGES, (l) => t(`language.${l}`), t(`language.${org.defaultExplanationLanguage}`))} onChange={(explanationLanguage) => updateMe.mutate({ explanationLanguage })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.theme')}</span>
        <Segmented<ThemeId | null> testid="pref-theme" value={user.theme} options={withDefault(THEMES, (th) => t(`theme.${th}`), t(`theme.${org.defaultTheme}`))} onChange={(theme) => updateMe.mutate({ theme })} />
      </div>
      <div className="field"><span className="field-label">{t('prefs.level')}</span>
        <Segmented<Level | null> testid="pref-level" value={user.initialLevel} options={withDefault(LEVELS, (l) => t(`level.${l}`), t('level.architecture'))} onChange={(initialLevel) => updateMe.mutate({ initialLevel })} />
      </div>
    </section>
  );
};
