import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { errorText } from '../errors';
import { SESSION_KEY, useSession } from '../session';

type Preview = { orgName: string; email: string; role: 'admin' | 'member'; status: 'valid' | 'expired' | 'revoked' | 'accepted' };

export const InvitePage = () => {
  const { t } = useI18n();
  const { token = '' } = useParams();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { data: session } = useSession();
  const preview = useQuery({ queryKey: ['invitation', token], queryFn: () => apiFetch<Preview>(`/invitations/${encodeURIComponent(token)}`), retry: false });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const accept = async () => {
    setBusy(true);
    try {
      const { orgId } = await apiFetch<{ orgId: string }>(`/invitations/${encodeURIComponent(token)}/accept`, { method: 'POST', body: {} });
      await client.invalidateQueries({ queryKey: SESSION_KEY });
      navigate(`/orgs/${orgId}/explore`, { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  if (preview.isLoading) return <p className="muted-a">{t('common.loading')}</p>;
  if (preview.isError || !preview.data || preview.data.status !== 'valid') {
    return <p className="alert error" data-testid="invite-unavailable">{t('invite.unavailable')}</p>;
  }
  const next = encodeURIComponent(`/invite/${token}`);
  return (
    <div className="auth-form">
      <h2>{t('invite.title', { org: preview.data.orgName })} 👋</h2>
      <p className="muted-a">{t('invite.body', { role: t(`role.${preview.data.role}`), email: preview.data.email })}</p>
      {error && <p className="alert error" role="alert">{error}</p>}
      {session ? (
        <PrimaryButton onClick={accept} loading={busy} data-testid="invite-accept">{t('invite.accept')} →</PrimaryButton>
      ) : (
        <div className="auth-links">
          <Link to={`/login?next=${next}`} data-testid="invite-signin">{t('invite.signInToAccept')}</Link>
          <Link to={`/signup?next=${next}`} data-testid="invite-signup">{t('invite.signUpToAccept')}</Link>
        </div>
      )}
    </div>
  );
};
