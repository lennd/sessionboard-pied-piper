import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';

type State = 'working' | 'done' | 'failed';

export const VerifyPage = () => {
  const { t } = useI18n();
  const [params] = useSearchParams();
  const [state, setState] = useState<State>('working');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    const token = params.get('token');
    if (!token) {
      setState('failed');
      return;
    }
    apiFetch('/auth/verify', { method: 'POST', body: { token } }).then(() => setState('done'), () => setState('failed'));
  }, [params]);

  const message = { working: t('auth.verify.working'), done: t('auth.verify.done'), failed: t('auth.verify.failed') }[state];
  return (
    <div className="auth-form">
      <h2>{state === 'done' ? '✨ ' : ''}{t('auth.checkEmail.title')}</h2>
      <p className={state === 'failed' ? 'alert error' : state === 'done' ? 'alert ok' : 'muted-a'} data-testid="verify-status">{message}</p>
      {state !== 'working' && <Link className="btn-primary" to="/login">{t('auth.goToSignIn')} →</Link>}
    </div>
  );
};
