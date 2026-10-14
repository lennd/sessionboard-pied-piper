import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { useSettingsContext } from './SettingsLayout';

type Rules = { text: string; count: number };
const ROWS = 12;

export const RulesPage = () => {
  const { t } = useI18n();
  const { repo: maybeRepo } = useSettingsContext();
  const repo = maybeRepo ?? { id: '' };
  const client = useQueryClient();
  const key = ['rules', repo.id];
  const rules = useQuery({ queryKey: key, queryFn: () => apiFetch<Rules>(`/repos/${repo.id}/rules`) });
  const [text, setText] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    if (rules.data) setText(rules.data.text);
  }, [rules.data]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const result = await apiFetch<Rules>(`/repos/${repo.id}/rules`, { method: 'PUT', body: { text } });
      client.setQueryData(key, result);
      setText(result.text);
      setSaved(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setSaving(false);
    }
  };
  const dirty = rules.data !== undefined && text.trimEnd() !== rules.data.text;

  return (
    <section>
      <h1>{t('rules.title')}</h1>
      <p className="shell-sub">{t('rules.subtitle')}</p>
      <textarea
        className="input"
        data-testid="rules-text"
        aria-label={t('rules.title')}
        rows={ROWS}
        placeholder={t('rules.placeholder')}
        value={text}
        style={{ width: '100%', fontFamily: 'ui-monospace, monospace', resize: 'vertical' }}
        onChange={(e) => {
          setText(e.target.value);
          setSaved(false);
        }}
      />
      <div className="row">
        <span className="muted-a" data-testid="rules-count">{rules.data ? t('rules.count', { count: rules.data.count }) : ''} · {t('rules.hint')}</span>
        <span className="shell-spacer" />
        {saved && <span className="alert ok" data-testid="rules-saved">{t('rules.saved')}</span>}
        <PrimaryButton data-testid="rules-save" loading={saving} disabled={!dirty} onClick={() => void save()}>{t('rules.save')}</PrimaryButton>
      </div>
      {error && <p className="alert error" role="alert">{error}</p>}
    </section>
  );
};
