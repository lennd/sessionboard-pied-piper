import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { formatDate } from '../format';
import { useSettingsContext } from './SettingsLayout';

type Role = 'owner' | 'admin' | 'member';
type Member = { userId: string; email: string; name: string; role: Role; joinedAt: string };
type Invitation = { id: string; email: string; role: 'admin' | 'member'; expiresAt: string };
type MembersResponse = { members: Member[]; invitations: Invitation[] };

export const MembersPage = () => {
  const { t, language } = useI18n();
  const { org, session } = useSettingsContext();
  const client = useQueryClient();
  const key = ['members', org.id];
  const query = useQuery({ queryKey: key, queryFn: () => apiFetch<MembersResponse>(`/orgs/${org.id}/members`) });
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'admin' | 'member'>('member');
  const [error, setError] = useState<string | null>(null);
  const canManage = org.role !== 'member';

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await client.invalidateQueries({ queryKey: key });
    } catch (err) {
      setError(errorText(t, err));
    }
  };
  const invite = (event: FormEvent) => {
    event.preventDefault();
    void run(async () => {
      await apiFetch(`/orgs/${org.id}/invitations`, { method: 'POST', body: { email, role } });
      setEmail('');
    });
  };

  return (
    <section>
      <h1>{t('members.title')}</h1>
      <p className="shell-sub">{t('members.subtitle')}</p>
      {error && <p className="alert error" role="alert" data-testid="members-error">{error}</p>}
      <table className="table">
        <tbody>
          {(query.data?.members ?? []).map((m) => {
            const self = m.userId === session.user.id;
            const editable = canManage && !self && (m.role !== 'owner' || org.role === 'owner');
            return (
              <tr key={m.userId} data-testid={`member-row-${m.userId}`}>
                <td>{m.email} {self && <span className="tag">{t('members.you')}</span>}</td>
                <td>{m.name}</td>
                <td>
                  {editable ? (
                    <select value={m.role} data-testid={`member-role-${m.userId}`} onChange={(e) => void run(() => apiFetch(`/orgs/${org.id}/members/${m.userId}`, { method: 'PATCH', body: { role: e.target.value } }))}>
                      {(org.role === 'owner' ? (['owner', 'admin', 'member'] as const) : (['admin', 'member'] as const)).map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
                    </select>
                  ) : (
                    <span className="tag">{t(`role.${m.role}`)}</span>
                  )}
                </td>
                <td style={{ textAlign: 'right' }}>
                  {(editable || self) && (
                    <GhostButton className="btn-danger" data-testid={`member-remove-${m.userId}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/members/${m.userId}`, { method: 'DELETE' }))}>
                      {self ? t('members.leave') : t('common.remove')}
                    </GhostButton>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {canManage && (
        <>
          <h3 style={{ marginTop: 28 }}>{t('members.invite')}</h3>
          <form className="row" onSubmit={invite}>
            <input className="input" style={{ maxWidth: 320 }} type="email" placeholder="sofi@acme.com" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="invite-email" aria-label={t('auth.email')} required />
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'member')} data-testid="invite-role" style={{ width: 140 }} aria-label={t('role.member')}>
              <option value="member">{t('role.member')}</option>
              <option value="admin">{t('role.admin')}</option>
            </select>
            <PrimaryButton className="btn-small" type="submit" data-testid="invite-submit">{t('members.send')} ↵</PrimaryButton>
          </form>
          {(query.data?.invitations.length ?? 0) > 0 && (
            <>
              <h3 style={{ marginTop: 28 }}>{t('members.pending')}</h3>
              <table className="table">
                <tbody>
                  {query.data!.invitations.map((i) => (
                    <tr key={i.id} data-testid={`invitation-${i.id}`}>
                      <td>{i.email}</td>
                      <td><span className="tag">{t(`role.${i.role}`)}</span></td>
                      <td className="muted-a">{t('members.expires', { date: formatDate(i.expiresAt, language) })}</td>
                      <td style={{ textAlign: 'right' }}>
                        <div className="row" style={{ justifyContent: 'flex-end' }}>
                          <GhostButton data-testid={`invitation-resend-${i.id}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/invitations/${i.id}/resend`, { method: 'POST', body: {} }))}>{t('members.resend')}</GhostButton>
                          <GhostButton className="btn-danger" data-testid={`invitation-revoke-${i.id}`} onClick={() => void run(() => apiFetch(`/orgs/${org.id}/invitations/${i.id}`, { method: 'DELETE' }))}>{t('members.revoke')}</GhostButton>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}
        </>
      )}
    </section>
  );
};
