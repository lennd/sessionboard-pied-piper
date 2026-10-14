import { fireEvent, render, screen } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { PlanPanel } from '../../src/shell/solutions/PlanPanel';
import type { SolutionDetail } from '../../src/shell/solutions/solutionsApi';

const scene = sampleRegistry['iot-telemetry']!;
const detail: SolutionDetail = {
  id: 'sol', title: 'Rate limits', status: 'in_progress', conversationId: null,
  versions: [{ n: 1, author: 'web', summary: 'first', createdAt: '2026-10-01T09:00:00Z' }, { n: 2, author: 'claude-code', summary: 'second', createdAt: '2026-10-01T10:00:00Z' }],
  version: { n: 2, author: 'claude-code', createdAt: '2026-10-01T10:00:00Z', draft: {
    summary: 'Throttle devices', sceneCurrent: null, sceneProposed: scene,
    plan: [{ id: 't1', title: 'Add limiter', nodeRefs: [scene.nodes[1]!.id], acceptance: ['429 after limit'], dependsOn: [] }, { id: 't2', title: 'Tests', nodeRefs: [], acceptance: [], dependsOn: ['t1'] }],
    risks: [{ title: 'Bursts throttled', severity: 'medium' }],
  } },
  tasks: { t1: { status: 'done', note: 'PR #12', updatedAt: '2026-10-01T10:05:00Z' } },
};

describe('PlanPanel', () => {
  it('shows the plan, its progress and risks, and highlights the pieces of a task', () => {
    const ctx = { openScene: vi.fn(), selectNode: vi.fn(), selected: null, scene: { ...scene, id: 'sol-v2-proposed' } };
    const onVersion = vi.fn();
    const onExecute = vi.fn();
    render(<I18nProvider initialLanguage="en"><PlanPanel detail={detail} ctx={ctx} onVersion={onVersion} onExecute={onExecute} /></I18nProvider>);
    expect(screen.getByTestId('plan-author')).toHaveTextContent('by Claude Code');
    expect(screen.getByTestId('plan-task-status-t1')).toHaveTextContent('done');
    expect(screen.getByTestId('plan-task-t1')).toHaveTextContent('PR #12');
    expect(screen.getByTestId('plan-task-status-t2')).toHaveTextContent('to do');
    expect(screen.getByTestId('plan-task-t2')).toHaveTextContent('After Add limiter');
    expect(screen.getByTestId('plan-risks')).toHaveTextContent('Bursts throttled');
    fireEvent.click(screen.getByTestId('plan-task-t1'));
    expect(ctx.selectNode).toHaveBeenCalledWith(scene.nodes[1]!.id);
    fireEvent.change(screen.getByTestId('plan-version'), { target: { value: '1' } });
    expect(onVersion).toHaveBeenCalledWith(1);
    fireEvent.click(screen.getByTestId('plan-execute'));
    expect(onExecute).toHaveBeenCalled();
  });
});
