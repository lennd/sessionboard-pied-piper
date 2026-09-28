import { fireEvent, render, screen } from '@testing-library/react';
import { sampleScenes } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { availableModes, hasScale, TopBar } from '../../src/workspace/panels/TopBar';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const renderBar = (props: Partial<Parameters<typeof TopBar>[0]> = {}, language: 'en' | 'es' | 'pt' = 'en') => {
  const handlers = { onSceneChange: vi.fn(), onLevel: vi.fn(), onMode: vi.fn(), onToggleOverlay: vi.fn(), onTheme: vi.fn() };
  render(
    <I18nProvider initialLanguage={language}>
      <TopBar scenes={sampleScenes} scene={scene} level="architecture" mode="walkthrough" scaleOverlay={false} theme="mission" {...handlers} {...props} />
    </I18nProvider>,
  );
  return handlers;
};

describe('TopBar', () => {
  it('derives modes and scale availability from content', () => {
    expect(availableModes(scene)).toEqual(['walkthrough', 'risks', 'changes']);
    expect(availableModes({ ...scene, steps: [], risks: [], nodes: scene.nodes.map((n) => ({ ...n, change: undefined })) })).toEqual([]);
    expect(hasScale(scene)).toBe(true);
    expect(hasScale({ ...scene, nodes: scene.nodes.map((n) => ({ ...n, scale: undefined })) })).toBe(false);
  });

  it('switches level, mode, overlay and theme', () => {
    const h = renderBar();
    expect(screen.getByTestId('level-architecture')).toHaveAttribute('aria-pressed', 'true');
    fireEvent.click(screen.getByTestId('level-detail'));
    fireEvent.click(screen.getByTestId('mode-risks'));
    fireEvent.click(screen.getByTestId('scale-overlay'));
    fireEvent.change(screen.getByTestId('theme-select'), { target: { value: 'paper' } });
    expect(h.onLevel).toHaveBeenCalledWith('detail');
    expect(h.onMode).toHaveBeenCalledWith('risks');
    expect(h.onToggleOverlay).toHaveBeenCalled();
    expect(h.onTheme).toHaveBeenCalledWith('paper');
  });

  it('hides modes and overlay the scene does not support', () => {
    renderBar({ scene: { ...scene, risks: [], nodes: scene.nodes.map((n) => ({ ...n, scale: undefined, change: undefined })) } });
    expect(screen.queryByTestId('mode-risks')).toBeNull();
    expect(screen.queryByTestId('mode-changes')).toBeNull();
    expect(screen.queryByTestId('scale-overlay')).toBeNull();
  });

  it('switches UI language and offers regeneration only when the primary subtag differs', () => {
    renderBar({ scene: { ...scene, language: 'pt-BR' } }, 'pt');
    expect(screen.queryByTestId('regenerate')).toBeNull();
    fireEvent.change(screen.getByTestId('language-select'), { target: { value: 'es' } });
    expect(screen.getByTestId('level-architecture')).toHaveTextContent('Arquitectura');
    expect(screen.getByTestId('regenerate')).toBeDisabled();
    expect(screen.getByTestId('regenerate')).toHaveTextContent('Regenerar en Español');
  });
});
