import { useState, type FormEvent } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const ResetPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/reset', { method: 'POST', body: { token: params.get('token') ?? '', password } });
      navigate('/login?reset=1', { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.reset.title')}</h2>
      <Field label={t('auth.password')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="reset-password" required />
      {error && <p className="alert error" role="alert">{error}</p>}
      <PrimaryButton type="submit" loading={busy} data-testid="reset-submit">{t('auth.reset.submit')}</PrimaryButton>
    </form>
  );
};
