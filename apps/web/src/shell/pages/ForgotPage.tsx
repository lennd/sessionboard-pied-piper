import { useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';

export const ForgotPage = () => {
  const { t } = useI18n();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await apiFetch('/auth/forgot', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="auth-form" onSubmit={submit} noValidate>
      <h2>{t('auth.forgotPage.title')}</h2>
      <p className="muted-a">{t('auth.forgotPage.subtitle')}</p>
      {sent ? (
        <p className="alert ok" data-testid="forgot-sent">{t('auth.forgotPage.sent')}</p>
      ) : (
        <>
          <Field label={t('auth.email')} type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} data-testid="forgot-email" required />
          {error && <p className="alert error" role="alert">{error}</p>}
          <PrimaryButton type="submit" loading={busy} data-testid="forgot-submit">{t('auth.forgotPage.submit')}</PrimaryButton>
        </>
      )}
      <div className="auth-links"><Link to="/login">{t('auth.back')}</Link></div>
    </form>
  );
};
