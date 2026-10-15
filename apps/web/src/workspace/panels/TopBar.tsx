import { LEVELS, type Level, type Scene } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
import { THEMES, type ThemeId } from '../../theme/themes';
import type { Mode } from '../engine/explorerState';
import { Logo } from './Logo';

export const availableModes = (scene: Scene): Mode[] => [
  ...(scene.steps.length > 0 ? (['walkthrough'] as const) : []),
  ...(scene.risks.length > 0 ? (['risks'] as const) : []),
  ...(scene.nodes.some((n) => n.change) ? (['changes'] as const) : []),
];

export const hasScale = (scene: Scene): boolean => scene.nodes.some((n) => n.scale);

type TopBarProps = {
  scenes: Scene[]; scene: Scene; level: Level; scaleOverlay: boolean; theme: ThemeId;
  onSceneChange: (id: string) => void; onLevel: (level: Level) => void;
  onToggleOverlay: () => void; onTheme: (theme: ThemeId) => void;
  onLanguage?: (language: UiLanguage) => void; homeHref?: string; context?: { title: string; detail?: string | null; href?: string };
};

export const TopBar = (p: TopBarProps) => {
  const { t, language, setLanguage } = useI18n();
  return (
    <header className="ws-top">
      <a className="ws-brand" href="/" data-testid="brand-home" title={t('nav.home')} aria-label={t('nav.home')}><Logo /></a>
      {p.context && (
        <a className="ws-context" href={p.context.href ?? p.homeHref ?? '/'} data-testid="ws-context" title={p.context.detail ? `${p.context.title} · ${p.context.detail}` : p.context.title}>
          <span className="ws-context-title">{p.context.title}</span>
          {p.context.detail && <span className="ws-context-detail">{p.context.detail}</span>}
        </a>
      )}
      <select className="select" data-testid="scene-select" aria-label={t('scene.label')} value={p.scene.id} onChange={(e) => p.onSceneChange(e.target.value)}>
        {p.scenes.map((s) => <option key={s.id} value={s.id}>{s.title} ({s.language})</option>)}
      </select>
      <div className="seg" role="group" aria-label={t('level.label')}>
        {LEVELS.map((level) => (
          <button key={level} type="button" data-testid={`level-${level}`} aria-pressed={p.level === level} onClick={() => p.onLevel(level)}>
            {t(`level.${level}`)}
          </button>
        ))}
      </div>
      {hasScale(p.scene) && (
        <button type="button" className={p.scaleOverlay ? 'btn btn-accent' : 'btn'} data-testid="scale-overlay" aria-pressed={p.scaleOverlay} onClick={p.onToggleOverlay}>
          {t('overlay.scale')}
        </button>
      )}
      <span className="ws-spacer" />
      <select className="select" data-testid="language-select" aria-label={t('language.label')} value={language} onChange={(e) => (p.onLanguage ?? setLanguage)(e.target.value as UiLanguage)}>
        {UI_LANGUAGES.map((l) => <option key={l} value={l}>{t(`language.${l}`)}</option>)}
      </select>
      {p.homeHref && (
        <a className="btn" href={p.homeHref} data-testid="home-link" title={t('nav.settings')}>⚙ {t('nav.settings')}</a>
      )}
      <select className="select" data-testid="theme-select" aria-label={t('theme.label')} value={p.theme} onChange={(e) => p.onTheme(e.target.value as ThemeId)}>
        {THEMES.map((th) => <option key={th} value={th}>◐ {t(`theme.${th}`)}</option>)}
      </select>
    </header>
  );
};
