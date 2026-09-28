import { useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { Segmented } from '../components/Segmented';
import { errorText } from '../errors';
import { SESSION_KEY } from '../session';
import { useSettingsContext } from './SettingsLayout';

export const GeneralPage = () => {
  const { t } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const canEdit = org.role !== 'member';
  const [name, setName] = useState(org.name);
  const [ui, setUi] = useState<UiLanguage>(org.defaultUiLanguage);
  const [explanation, setExplanation] = useState<UiLanguage>(org.defaultExplanationLanguage);
  const [theme, setTheme] = useState<ThemeId>(org.defaultTheme);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const languages = UI_LANGUAGES.map((l) => ({ value: l, label: t(`language.${l}`) }));

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      await apiFetch(`/orgs/${org.id}`, { method: 'PATCH', body: { name, defaultUiLanguage: ui, defaultExplanationLanguage: explanation, defaultTheme: theme } });
      await client.refetchQueries({ queryKey: SESSION_KEY });
      setSaved(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section>
      <h1>{t('general.title')}</h1>
      <p className="shell-sub">{t('general.subtitle')}</p>
      {!canEdit && <p className="alert ok">{t('general.readOnly')}</p>}
      <div className="form-grid">
        <Field label={t('general.name')} value={name} onChange={(e) => setName(e.target.value)} disabled={!canEdit} data-testid="general-name" />
        <div className="field"><span className="field-label">{t('general.uiLanguage')}</span><Segmented testid="general-ui" value={ui} options={languages} onChange={setUi} disabled={!canEdit} /></div>
        <div className="field"><span className="field-label">{t('general.explanationLanguage')}</span><Segmented testid="general-explanation" value={explanation} options={languages} onChange={setExplanation} disabled={!canEdit} /></div>
        <div className="field"><span className="field-label">{t('general.theme')}</span><Segmented testid="general-theme" value={theme} options={THEMES.map((th) => ({ value: th, label: t(`theme.${th}`) }))} onChange={setTheme} disabled={!canEdit} /></div>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
      <div className="row" style={{ marginTop: 8 }}>
        <PrimaryButton className="btn-small" onClick={save} loading={busy} disabled={!canEdit} data-testid="general-save">{t('common.save')}</PrimaryButton>
        {saved && <span className="muted-a" data-testid="general-saved">{t('common.saved')}</span>}
      </div>
    </section>
  );
};
