import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { ReviewPage } from '../../src/shell/reviews/ReviewPage';
import { prefsFixture, renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/chat/chatApi', async (original) => ({ ...(await original<typeof import('../../src/shell/chat/chatApi')>()), explainToScene: vi.fn() }));
import { explainToScene } from '../../src/shell/chat/chatApi';
const opened = vi.hoisted(() => ({ calls: [] as unknown[] }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes, panels, context }: { extraScenes: { id: string }[]; panels: { id: string; render: (ctx: unknown) => unknown }[]; context: { title: string; detail: string } }) => {
    const ctx = { openScene: (...args: unknown[]) => opened.calls.push(args), selectNode: vi.fn(), selected: null, scene: sampleRegistry['iot-telemetry'] };
    return (
      <div data-testid="workspace">
        <div data-testid="workspace-context">{context.title} · {context.detail}</div>
        <div data-testid="workspace-scenes">{extraScenes.map((s) => s.id).join(',')}</div>
        {panels.map((p) => <div key={p.id} data-testid={`panel-${p.id}`}>{p.render(ctx) as never}</div>)}
      </div>
    );
  },
}));
const api = vi.mocked(apiFetch);
const explainMock = vi.mocked(explainToScene);
const scene = sampleRegistry['iot-telemetry']!;
const withRepos = (id: string) => ({ ...scene, id, nodes: scene.nodes.map((n, i) => ({ ...n, repo: i % 2 ? 'shop-web' : 'shop-api' })), risks: [
  { id: 'c1', title: 'Field renamed on one side', category: 'reliability' as const, severity: 'high' as const, explanation: 'x', nodeIds: [scene.nodes[0]!.id, scene.nodes[1]!.id] },
  { id: 'a1', title: 'Slow query', category: 'performance' as const, severity: 'low' as const, explanation: 'y', nodeIds: [scene.nodes[0]!.id] },
] });
const review = { id: 'rv1', title: 'shop-api #7 + shop-web #9', selections: [], parts: [{ repoId: 'r1', name: 'shop-api', pull: 7, available: true, url: 'https://github.com/acme/shop-api/pull/7' }, { repoId: 'r2', name: 'shop-web', pull: 9, available: true, url: null }], explainedAt: null, createdAt: '', updatedAt: '' };

beforeEach(() => {
  api.mockReset();
  explainMock.mockReset();
  opened.calls.length = 0;
  explainMock.mockResolvedValue({ id: 'sc', scene: withRepos('review-impact-rv1-explained'), text: 'The API renames **total**; the web still reads it.' });
  api.mockImplementation(async (path) => {
    const p = String(path);
    if (p === '/reviews/rv1') return review as never;
    if (p === '/reviews/rv1/impact') return { scene: withRepos('review-impact-rv1'), touched: [], missing: [] } as never;
    if (p === '/reviews/rv1/explanation') throw new ApiError(404, 'not_found');
    return prefsFixture() as never;
  });
});

describe('ReviewPage', () => {
  it('shows the parts, the combined impact scene, and explains the change across repositories', async () => {
    renderShell(<ReviewPage />, { route: '/reviews/rv1', path: '/reviews/:reviewId', prefs: prefsFixture() });
    expect(await screen.findByTestId('review-panel')).toBeInTheDocument();
    expect(screen.getByTestId('workspace-context')).toHaveTextContent('shop-api #7 · shop-web #9');
    expect(screen.getByTestId('review-part-r1')).toHaveTextContent('#7');
    await waitFor(() => expect(screen.getByTestId('workspace-scenes')).toHaveTextContent('review-impact-rv1'));
    fireEvent.click(screen.getByTestId('review-explain'));
    expect(await screen.findByTestId('review-explanation')).toHaveTextContent('The API renames total');
    expect(explainMock).toHaveBeenCalledWith('/reviews/rv1', {}, expect.any(Function));
    expect(opened.calls.at(-1)).toEqual([expect.objectContaining({ id: 'review-impact-rv1-explained' }), 'changes']);
    expect(screen.getByTestId('review-risks-contract')).toHaveTextContent('shop-api ↔ shop-web');
    expect(screen.getByTestId('review-risks-contract')).toHaveTextContent('Field renamed on one side');
    expect(screen.getByTestId('review-risks-shop-api')).toHaveTextContent('Slow query');
    expect(screen.getByTestId('review-explain')).toHaveTextContent('Explain again');
  });
});
