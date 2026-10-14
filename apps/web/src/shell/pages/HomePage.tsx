import { Link } from 'react-router-dom';
import { useI18n } from '../../i18n/I18nProvider';
import { PiperMark } from '../../components/PiperMark';
import { PiperScene, type PiperSceneVariant } from '../../components/PiperScenes';
import { AuroraBackground } from '../components/AuroraBackground';
import { SetupCard } from '../components/SetupCard';
import { useFeatures } from '../features/featuresApi';
import { useRepos } from '../local';

const MARK = 128;

/** The front door: the mark, the name, and the three places to go. */
export const HomePage = () => {
  const { t } = useI18n();
  const repos = useRepos();
  const features = useFeatures();
  const cards: { to: string; testid: string; picture: PiperSceneVariant; title: string; hint: string }[] = [
    { to: '/repos', testid: 'home-repos', picture: 'repos', title: t('nav.repositories'), hint: repos.data ? t('home.reposHint', { count: repos.data.length }) : t('repos.subtitle') },
    { to: '/features?new=1', testid: 'home-new-feature', picture: 'feature', title: t('features.new'), hint: features.data ? t('home.featuresHint', { count: features.data.length }) : t('features.subtitle') },
    { to: '/settings', testid: 'home-settings', picture: 'settings', title: t('nav.settings'), hint: t('home.settingsHint') },
  ];
  return (
    <AuroraBackground>
      <main className="home" data-testid="home">
        <div className="home-hero rise">
          <PiperMark size={MARK} />
          <h1 className="home-wordmark">{t('app.name').toLowerCase()}</h1>
          <p className="home-tagline">{t('home.tagline')}</p>
        </div>
        <SetupCard always />
        <nav className="home-cards" aria-label={t('home.go')}>
          {cards.map((c) => (
            <Link key={c.to} to={c.to} className="home-card glass rise" data-testid={c.testid}>
              <span className="home-card-picture" data-testid={`home-picture-${c.picture}`}><PiperScene variant={c.picture} /></span>
              <span className="home-card-title">{c.title}</span>
              <span className="home-card-hint">{c.hint}</span>
            </Link>
          ))}
        </nav>
      </main>
    </AuroraBackground>
  );
};
