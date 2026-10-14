import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { FeaturePage } from '../../src/shell/features/FeaturePage';
import { subscribeSolution } from '../../src/shell/solutions/solutionsApi';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/solutions/solutionsApi', async (original) => ({ ...(await original<typeof import('../../src/shell/solutions/solutionsApi')>()), subscribeSolution: vi.fn(() => () => {}) }));
const asked = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes, panels, chat }: { extraScenes: { id: string }[]; panels: { id: string; render: (ctx: unknown) => unknown }[]; chat: (ctx: unknown) => unknown }) => {
    const ctx = { openScene: vi.fn(), selectNode: vi.fn(), selected: null, scene: sampleRegistry['iot-telemetry'], ask: (...args: unknown[]) => asked.calls.push(args) };
    return (
      <div data-testid="workspace">
        <div data-testid="workspace-scenes">{extraScenes.map((s) => s.id).join(',')}</div>
        {panels.map((p) => <div key={p.id} data-testid={`panel-${p.id}`}>{p.render(ctx) as never}</div>)}
        <div data-testid="panel-chat">{chat(ctx) as never}</div>
      </div>
    );
  },
}));
vi.mock('../../src/shell/chat/ChatPanel', () => ({ ChatPanel: ({ base }: { base: string }) => <div data-testid="chat">{base}</div> }));
vi.mock('../../src/shell/solutions/RunView', () => ({ RunView: ({ repoId, runId }: { repoId: string; runId: string }) => <div data-testid="run-view">{repoId}/{runId}</div> }));
const api = vi.mocked(apiFetch);
const scene = sampleRegistry['iot-telemetry']!;
const feature = { id: 'f1', title: 'Checkout 2FA', status: 'draft', repoIds: ['r1', 'r2'], brief: 'Add 2FA', createdAt: '', updatedAt: '', repos: [{ id: 'r1', name: 'shop-api', path: '/a', available: true }, { id: 'r2', name: 'shop-web', path: '/b', available: true }], plan: { id: 'sol', status: 'draft', latestVersion: 1, progress: { done: 0, total: 2 } } };
const detail = {
  id: 'sol', title: 'Plan', status: 'draft', conversationId: null,
  versions: [{ n: 1, author: 'web', summary: 's', createdAt: '' }],
  version: { n: 1, author: 'web', createdAt: '', draft: { summary: 's', sceneCurrent: null, sceneProposed: scene, plan: [{ id: 't1', title: 'API endpoint', repo: 'shop-api', nodeRefs: [], acceptance: [], dependsOn: [] }, { id: 't2', title: 'UI form', repo: 'shop-web', nodeRefs: [], acceptance: [], dependsOn: ['t1'] }], risks: [] } },
  tasks: { t1: { status: 'done', note: null, updatedAt: '' } },
};

beforeEach(() => {
  api.mockReset();
  asked.calls.length = 0;
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p === '/features/f1' && init?.method === 'PATCH') return { ...feature, ...(init.body as object) } as never;
    if (p === '/features/f1') return feature as never;
    if (p.startsWith('/features/f1/solutions/sol')) return detail as never;
    if (p === '/features/f1/runs') return [{ id: 'run1', repoId: 'r1', featureId: 'f1', solutionId: 'sol', status: 'done', startedAt: '', endedAt: '', pending: [] }] as never;
    if (p === '/features/f1/repos/r2/run' && init?.method === 'POST') return { id: 'run2', repoId: 'r2', featureId: 'f1', solutionId: 'sol', status: 'running', startedAt: '', endedAt: null, pending: [] } as never;
    if (p === '/repos') return [repoFixture(), repoFixture({ id: 'r2', name: 'shop-web' })] as never;
    if (p === '/features/f1/system-map') return { scene: { ...scene, id: 'feature-map-f1' }, missing: [] } as never;
    if (p === '/features/f1/impact') throw new ApiError(404, 'no_system_map');
    throw new Error(`unexpected ${p}`);
  });
});

const open = () => renderShell(<FeaturePage />, { route: '/features/f1', path: '/features/:featureId', prefs: prefsFixture(), repos: [repoFixture(), repoFixture({ id: 'r2', name: 'shop-web' })] });

describe('FeaturePage', () => {
  it('shows the brief, the plan grouped by repository with run state, and the feature chat', async () => {
    open();
    await waitFor(() => expect(screen.getByTestId('workspace-scenes')).toHaveTextContent('sol-v1-proposed'));
    await waitFor(() => expect(screen.getByTestId('workspace-scenes')).toHaveTextContent('feature-map-f1'));
    expect(screen.getByTestId('brief-text')).toHaveValue('Add 2FA');
    expect(screen.getByTestId('chat')).toHaveTextContent('/features/f1');
    expect(screen.getByTestId('plan-repo-r1')).toHaveTextContent('shop-api');
    expect(screen.getByTestId('plan-repo-r1')).toHaveTextContent('API endpoint');
    expect(screen.getByTestId('plan-repo-r2')).toHaveTextContent('UI form');
    expect(screen.getByTestId('plan-task-t2')).toHaveTextContent('After shop-api/API endpoint');
    await waitFor(() => expect(screen.getByTestId('plan-repo-run-r1')).toHaveTextContent('done'));
    expect(screen.queryByTestId('plan-execute')).not.toBeInTheDocument();
  });

  it('saves the brief, proposes a plan through the chat and runs one repository', async () => {
    open();
    await screen.findByTestId('brief-text');
    fireEvent.change(screen.getByTestId('brief-text'), { target: { value: 'Add 2FA with TOTP' } });
    fireEvent.click(screen.getByTestId('brief-save'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/features/f1', { method: 'PATCH', body: { title: 'Checkout 2FA', brief: 'Add 2FA with TOTP' } }));
    expect(await screen.findByTestId('brief-saved')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('brief-propose'));
    await waitFor(() => expect(asked.calls).toEqual([['Add 2FA with TOTP', 'plan']]));
    fireEvent.click(screen.getByTestId('brief-repo-r2'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/features/f1', { method: 'PATCH', body: { repoIds: ['r1'] } }));
    fireEvent.click(await screen.findByTestId('plan-execute-r2'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/features/f1/repos/r2/run', { method: 'POST', body: {} }));
    expect(await screen.findByTestId('feature-run-dialog')).toBeInTheDocument();
  });
});
