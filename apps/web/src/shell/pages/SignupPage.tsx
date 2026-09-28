import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const SignupPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/signup', { method: 'POST', body: { name, email, password } });
      navigate(`/check-email?email=${encodeURIComponent(email)}`);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.signUp.title')}</h2>
      <p className="muted-a">{t('auth.signUp.subtitle')}</p>
      <Field label={t('auth.name')} autoComplete="name" value={name} onChange={(e) => setName(e.target.value)} data-testid="signup-name" required />
      <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="signup-email" required />
      <Field label={t('auth.password')} type="password" autoComplete="new-password" hint={t('auth.passwordHint')} value={password} onChange={(e) => setPassword(e.target.value)} data-testid="signup-password" required />
      {error && <p className="alert error" role="alert" data-testid="form-error">{error}</p>}
      <PrimaryButton type="submit" loading={busy} data-testid="signup-submit">{t('auth.signUp.submit')} →</PrimaryButton>
      <div className="auth-links"><Link to="/login">{t('auth.haveAccount')}</Link></div>
    </form>
  );
};
