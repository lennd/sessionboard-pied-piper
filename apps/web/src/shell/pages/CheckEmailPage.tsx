import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { GhostButton } from '../components/Buttons';

export const CheckEmailPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const email = params.get('email') ?? '';
  const [resent, setResent] = useState(false);
  const resend = async () => {
    await apiFetch('/auth/resend-verification', { method: 'POST', body: { email } });
    setResent(true);
  };
  return (
    <div className="auth-form">
      <h2>{t('auth.checkEmail.title')} ✉️</h2>
      <p className="muted-a">{t('auth.checkEmail.body', { email })}</p>
      <div className="row" style={{ marginTop: 16 }}>
        <GhostButton onClick={resend} disabled={!email || resent} data-testid="resend-verification">{resent ? t('auth.resent') : t('auth.resend')}</GhostButton>
        <Link className="link" to="/login">{t('auth.back')}</Link>
      </div>
    </div>
  );
};
