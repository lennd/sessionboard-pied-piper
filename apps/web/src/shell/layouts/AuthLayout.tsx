import { Outlet } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { AnimatedLogo } from '../components/AnimatedLogo';
import { AuroraBackground } from '../components/AuroraBackground';
import { LanguagePills } from '../components/LanguagePills';
import { MiniFlow } from '../components/MiniFlow';

export const AuthLayout = () => {
  const { t } = useI18n();
  return (
    <AuroraBackground>
      <div className="auth-grid">
        <section className="auth-pitch">
          <AnimatedLogo />
          <h1>
            {t('shell.headline')} <span className="shimmer">{t('shell.headlineAccent')}</span>
          </h1>
          <p className="auth-lead">{t('shell.lead')}</p>
          <MiniFlow />
          <footer className="auth-footer">{t('shell.footer')}</footer>
        </section>
        <section className="auth-panel">
          <div className="glass auth-card rise">
            <div className="auth-card-top"><LanguagePills /></div>
            <Outlet />
          </div>
        </section>
      </div>
    </AuroraBackground>
  );
};
