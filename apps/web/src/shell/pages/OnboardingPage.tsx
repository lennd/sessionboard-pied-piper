import { useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { apiFetch } from '../api';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { PrimaryButton } from '../components/Buttons';
import { Field } from '../components/Field';
import { errorText } from '../errors';
import { SESSION_KEY, type SessionOrg } from '../session';

export const OnboardingPage = () => {
  const { t } = useI18n();
  const navigate = useNavigate();
  const client = useQueryClient();
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const org = await apiFetch<SessionOrg>('/orgs', { method: 'POST', body: { name } });
      await client.refetchQueries({ queryKey: SESSION_KEY });
      navigate(`/orgs/${org.id}/explore`, { replace: true });
    } catch (err) {
      setError(errorText(t, err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuroraBackground>
      <div className="splash">
        <form className="glass auth-card rise auth-form" style={{ maxWidth: 520 }} onSubmit={submit}>
          <AnimatedLogo size={30} />
          <h2 style={{ marginTop: 18 }}>{t('onboarding.title')}</h2>
          <ol className="steps-list">
            <li className="is-active">1 · {t('onboarding.step1')}</li>
            <li>2 · {t('onboarding.step2')} <span className="muted-a">({t('onboarding.soon')})</span></li>
            <li>3 · {t('onboarding.step3')}</li>
          </ol>
          <Field label={t('onboarding.orgName')} value={name} onChange={(e) => setName(e.target.value)} data-testid="onboarding-name" required />
          {error && <p className="alert error" role="alert">{error}</p>}
          <PrimaryButton type="submit" loading={busy} disabled={!name.trim()} data-testid="onboarding-submit">{t('onboarding.create')} →</PrimaryButton>
        </form>
      </div>
    </AuroraBackground>
  );
};
