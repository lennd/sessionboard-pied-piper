import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { formatRelative } from '../format';

type SessionInfo = { id: string; createdAt: string; lastSeenAt: string; userAgent: string | null; ip: string | null; current: boolean };
const SESSIONS_KEY = ['me', 'sessions'];

export const SecurityPage = () => {
  const { t, language } = useI18n();
  const client = useQueryClient();
  const sessions = useQuery({ queryKey: SESSIONS_KEY, queryFn: () => apiFetch<SessionInfo[]>('/me/sessions') });
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [updated, setUpdated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const change = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setUpdated(false);
    try {
      await apiFetch('/me/password', { method: 'POST', body: { currentPassword: current, newPassword: next } });
      setUpdated(true);
      setCurrent('');
      setNext('');
      await client.invalidateQueries({ queryKey: SESSIONS_KEY });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const revoke = async (id: string) => {
    await apiFetch(`/me/sessions/${id}`, { method: 'DELETE' });
    await client.invalidateQueries({ queryKey: SESSIONS_KEY });
  };

  return (
    <section>
      <h1>{t('security.title')}</h1>
      <form onSubmit={change} style={{ maxWidth: 420 }}>
        <h3>{t('security.password')}</h3>
        <Field label={t('security.current')} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} data-testid="password-current" />
        <Field label={t('security.new')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={next} onChange={(e) => setNext(e.target.value)} data-testid="password-new" />
        {error && <p className="alert error" role="alert">{error}</p>}
        {updated && <p className="alert ok" data-testid="password-updated">{t('security.updated')}</p>}
        <PrimaryButton className="btn-small" style={{ marginTop: 14 }} type="submit" loading={busy} data-testid="password-submit">{t('security.update')}</PrimaryButton>
      </form>
      <h3 style={{ marginTop: 30 }}>{t('security.sessions')}</h3>
      <table className="table">
        <tbody>
          {(sessions.data ?? []).map((s) => (
            <tr key={s.id} data-testid={`session-${s.id}`}>
              <td>{s.userAgent ?? '—'} {s.current && <span className="tag">{t('security.thisDevice')}</span>}</td>
              <td className="muted-a">{s.ip}</td>
              <td className="muted-a">{t('security.lastSeen', { date: formatRelative(s.lastSeenAt, language) ?? '' })}</td>
              <td style={{ textAlign: 'right' }}>
                {!s.current && <GhostButton data-testid={`session-revoke-${s.id}`} onClick={() => void revoke(s.id)}>{t('security.revoke')}</GhostButton>}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
};
