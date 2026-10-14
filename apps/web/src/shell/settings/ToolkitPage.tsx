import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { useSettingsContext } from './SettingsLayout';

type Toolkit = { text: string };
const ROWS = 12;

export const ToolkitPage = () => {
  const { t } = useI18n();
  const { repo } = useSettingsContext();
  const client = useQueryClient();
  const key = ['toolkit', repo.id];
  const toolkit = useQuery({ queryKey: key, queryFn: () => apiFetch<Toolkit>(`/repos/${repo.id}/toolkit`) });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (toolkit.data) setText(toolkit.data.text);
  }, [toolkit.data]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await apiFetch<Toolkit>(`/repos/${repo.id}/toolkit`, { method: 'PUT', body: { text } });
      client.setQueryData(key, result);
      setText(result.text);
      setSaved(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  };
  const dirty = toolkit.data !== undefined && text.trimEnd() !== toolkit.data.text;

  return (
    <section>
      <h1>{t('toolkit.title')}</h1>
      <p className="shell-sub">{t('toolkit.subtitle')}</p>
      <textarea
        className="input"
        data-testid="toolkit-text"
        aria-label={t('toolkit.title')}
        rows={ROWS}
        placeholder={t('toolkit.placeholder')}
        value={text}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
      />
      <div className="row">
        <span className="shell-spacer" />
        {saved && <span className="alert ok" data-testid="toolkit-saved">{t('toolkit.saved')}</span>}
        <PrimaryButton data-testid="toolkit-save" loading={saving} disabled={!dirty} onClick={() => void save()}>{t('toolkit.save')}</PrimaryButton>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
    </section>
  );
};
