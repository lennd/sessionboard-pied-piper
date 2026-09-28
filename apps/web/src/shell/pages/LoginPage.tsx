import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { ApiError, apiFetch } from '../api';
import { GhostButton, PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { safeNext } from '../preferences';
import { acceptSession, type SessionData } from '../session';

export const LoginPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const client = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [unverified, setUnverified] = useState(false);
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const session = await apiFetch<SessionData>('/auth/login', { method: 'POST', body: { email, password } });
      acceptSession(client, session);
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setUnverified(err instanceof ApiError && err.code === 'email_not_verified');
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  const resend = async () => {
    await apiFetch('/auth/resend-verification', { method: 'POST', body: { email } });
    setResent(true);
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.signIn.title')}</h2>
      <p className="muted-a">{t('auth.signIn.subtitle')}</p>
      {params.get('reset') && <p className="alert ok">{t('auth.reset.done')}</p>}
      <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="login-email" required />
      <Field label={t('auth.password')} type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} data-testid="login-password" required />
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      {unverified && (
        <GhostButton onClick={resend} data-testid="resend-verification" style={{ marginTop: 10 }}>
          {resent ? t('auth.resent') : t('auth.resend')}
        </GhostButton>
      )}
      <PrimaryButton type="submit" loading={busy} data-testid="login-submit">{t('auth.signIn.submit')} →</PrimaryButton>
      <div className="auth-links">
        <Link to="/forgot">{t('auth.forgot')}</Link>
        <Link to="/signup">{t('auth.createOrg')}</Link>
      </div>
    </form>
  );
};
