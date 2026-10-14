import { LEVELS, type Level, type Scene } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { primarySubtag, UI_LANGUAGES, type UiLanguage } from '../../i18n/messages';
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
  scenes: Scene[]; scene: Scene; level: Level; mode: Mode; scaleOverlay: boolean; theme: ThemeId;
  onSceneChange: (id: string) => void; onLevel: (level: Level) => void; onMode: (mode: Mode) => void;
  onToggleOverlay: () => void; onTheme: (theme: ThemeId) => void;
  onLanguage?: (language: UiLanguage) => void; homeHref?: string;
};

export const TopBar = (p: TopBarProps) => {
  const { t, language, setLanguage } = useI18n();
  const regenerate = primarySubtag(p.scene.language) !== language;
  return (
    <header className="ws-top">
      <a className="ws-brand" href="/" data-testid="brand-home" title={t('nav.home')} aria-label={t('nav.home')}><Logo /></a>
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
      <div className="tabs-inline" role="tablist">
        {availableModes(p.scene).map((mode) => (
          <button key={mode} type="button" role="tab" data-testid={`mode-${mode}`} aria-selected={p.mode === mode} onClick={() => p.onMode(mode)}>
            {t(`mode.${mode}`)}
          </button>
        ))}
      </div>
      {hasScale(p.scene) && (
        <button type="button" className={p.scaleOverlay ? 'btn btn-accent' : 'btn'} data-testid="scale-overlay" aria-pressed={p.scaleOverlay} onClick={p.onToggleOverlay}>
          {t('overlay.scale')}
        </button>
      )}
      <span className="ws-spacer" />
      {regenerate && (
        <button type="button" className="btn" data-testid="regenerate" disabled title={t('scene.regenerateSoon')}>
          {t('scene.regenerate', { language: t(`language.${language}`) })}
        </button>
      )}
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
