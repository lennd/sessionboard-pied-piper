import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { formatRelative } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Token = { id: string; name: string; prefix: string; lastUsedAt: string | null; createdAt: string };

export const TokensPage = () => {
  const { t, language } = useI18n();
  const { org } = useSettingsContext();
  const client = useQueryClient();
  const key = ['tokens', org.id];
  const tokens = useQuery({ queryKey: key, queryFn: () => apiFetch<Token[]>(`/orgs/${org.id}/tokens`) });
  const [name, setName] = useState('');
  const [created, setCreated] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      const result = await apiFetch<Token & { token: string }>(`/orgs/${org.id}/tokens`, { method: 'POST', body: { name } });
      setCreated(result.token);
      setName('');
      await client.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const revoke = async (id: string) => {
    await apiFetch(`/orgs/${org.id}/tokens/${id}`, { method: 'DELETE' });
    await client.invalidateQueries({ queryKey: key });
  };

  return (
    <section>
      <h1>{t('tokens.title')}</h1>
      <p className="shell-sub">{t('tokens.subtitle')}</p>
      <form className="row" onSubmit={create} style={{ alignItems: 'flex-end', margin: '14px 0' }}>
        <Field label={t('tokens.name')} value={name} onChange={(e) => setName(e.target.value)} data-testid="token-name" required maxLength={80} />
        <PrimaryButton className="btn-small" type="submit" data-testid="token-create" disabled={!name.trim()}>{t('tokens.create')}</PrimaryButton>
      </form>
      {error && <p className="alert error" role="alert">{error}</p>}
      {created && <p className="alert ok" data-testid="token-created">{t('tokens.created')} <code>{created}</code></p>}
      {tokens.data && tokens.data.length === 0 && <p className="muted-a">{t('tokens.empty')}</p>}
      {tokens.data && tokens.data.length > 0 && (
        <table className="table">
          <tbody>
            {tokens.data.map((token) => (
              <tr key={token.id} data-testid={`token-${token.id}`}>
                <td>{token.name}</td>
                <td><code>{token.prefix}…</code></td>
                <td className="muted-a">{token.lastUsedAt ? t('tokens.lastUsed', { when: formatRelative(token.lastUsedAt, language) ?? '' }) : t('tokens.neverUsed')}</td>
                <td style={{ textAlign: 'right' }}><GhostButton className="btn-danger" data-testid={`token-revoke-${token.id}`} onClick={() => void revoke(token.id)}>{t('tokens.revoke')}</GhostButton></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
};
