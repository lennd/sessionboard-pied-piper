import { act, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { apiFetch } from '../../src/shell/api';
import { SolutionPage } from '../../src/shell/pages/SolutionPage';
import { subscribeSolution } from '../../src/shell/solutions/solutionsApi';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/solutions/solutionsApi', async (original) => ({ ...(await original<typeof import('../../src/shell/solutions/solutionsApi')>()), subscribeSolution: vi.fn() }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes, panels, initialPanel }: { extraScenes: { id: string }[]; panels: { id: string }[]; initialPanel: string }) => (
    <div data-testid="workspace">{extraScenes.map((s) => s.id).join(',')}|{panels.map((p) => p.id).join(',')}|{initialPanel}</div>
  ),
}));
const api = vi.mocked(apiFetch);
const subscribe = vi.mocked(subscribeSolution);
const scene = sampleRegistry['iot-telemetry']!;
const detail = (n: number) => ({ id: 'sol', title: 'x', status: 'draft', conversationId: null, versions: [{ n, author: 'web', summary: 's', createdAt: '2026-10-01T10:00:00Z' }], version: { n, author: 'web', createdAt: '2026-10-01T10:00:00Z', draft: { summary: 's', sceneProposed: scene, sceneCurrent: null, plan: [], risks: [] } }, tasks: {} });

describe('SolutionPage', () => {
  it('opens the proposed scene with the plan panel and refreshes on live events', async () => {
    let version = 1;
    let notify: () => void = () => {};
    api.mockImplementation(async (path) => (String(path).startsWith('/orgs/o1/solutions/sol') ? detail(version) : sessionFixture()) as never);
    subscribe.mockImplementation((_o, _s, onEvent) => { notify = onEvent; return () => {}; });
    renderShell(<SolutionPage />, { route: '/orgs/o1/solutions/sol', path: '/orgs/:orgId/solutions/:solutionId', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('sol-v1-proposed|plan|plan'));
    version = 2;
    await act(async () => notify());
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('sol-v2-proposed'));
  });
});
