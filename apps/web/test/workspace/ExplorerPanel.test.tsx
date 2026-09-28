import { fireEvent, render, screen } from '@testing-library/react';
import { computeVisible, flattenSteps, indexScene, numberSteps, sampleRegistry, type Scene } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { initialExplorerState } from '../../src/workspace/engine/explorerState';
import { risksByNode } from '../../src/workspace/engine/risks';
import { ExplorerPanel } from '../../src/workspace/panels/ExplorerPanel';
import { fixtureScene } from './fixture';

const renderPanel = (scene: Scene) => {
  const index = indexScene(scene);
  const handlers = { onSelectNode: vi.fn(), onToggleExpand: vi.fn(), onSeek: vi.fn(), onToggleStep: vi.fn(), onSelectRisk: vi.fn(), onSetMode: vi.fn() };
  render(
    <I18nProvider initialLanguage="en">
      <ExplorerPanel scene={scene} index={index} model={computeVisible(scene, index, 'architecture', new Set())} explorer={initialExplorerState(scene.id, 'architecture')}
        flat={flattenSteps(scene.steps, new Set())} cursor={0} numbering={numberSteps(scene.steps)} byNode={risksByNode(scene)} {...handlers} />
    </I18nProvider>,
  );
  return handlers;
};

describe('ExplorerPanel', () => {
  it('only offers the modes the scene supports', () => {
    renderPanel(sampleRegistry['iot-telemetry']!);
    expect(screen.getByTestId('activity-walkthrough')).toBeInTheDocument();
    expect(screen.getByTestId('activity-risks')).toBeInTheDocument();
    expect(screen.queryByTestId('activity-changes')).toBeNull();
  });

  it('selects pieces through keyboard-reachable buttons', () => {
    const { onSelectNode } = renderPanel(fixtureScene());
    const label = screen.getByRole('button', { name: /^⚙ API/ });
    label.focus();
    expect(label).toHaveFocus();
    fireEvent.click(label);
    expect(onSelectNode).toHaveBeenCalledWith('api');
  });
});
