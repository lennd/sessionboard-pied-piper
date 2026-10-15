import { NavLink } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';

/** Top-level switch between the two home lists: repositories and features. */
export const HomeNav = () => {
  const { t } = useI18n();
  const cls = ({ isActive }: { isActive: boolean }) => (isActive ? 'home-nav-item is-active' : 'home-nav-item');
  return (
    <nav className="home-nav" aria-label={t('nav.repositories')}>
      <NavLink to="/repos" className={cls} data-testid="home-nav-repos">{t('nav.repositories')}</NavLink>
      <NavLink to="/features" className={cls} data-testid="home-nav-features">{t('nav.features')}</NavLink>
      <NavLink to="/reviews" className={cls} data-testid="home-nav-reviews">{t('nav.reviews')}</NavLink>
      <NavLink to="/settings" className={cls} data-testid="home-nav-settings">{t('nav.settings')}</NavLink>
    </nav>
  );
};
