import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { SessionsPanel } from '../../src/shell/sessions/SessionsPanel';
import { forgetSessions, upsertEvent, type SessionDetail, type TimelineEvent } from '../../src/shell/sessions/sessionsApi';
import { renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const scene = sampleRegistry['iot-telemetry']!;
const sources: FakeEventSource[] = [];
class FakeEventSource {
  listeners: Record<string, (e: { data: string }) => void> = {};
  closed = false;
  constructor(public url: string) { sources.push(this); }
  addEventListener(type: string, fn: (e: { data: string }) => void) { this.listeners[type] = fn; }
  close() { this.closed = true; }
  emit(type: string, data: unknown) { this.listeners[type]?.({ data: JSON.stringify(data) }); }
}
const edit: TimelineEvent = { id: 'e1', ts: '2026-10-13T10:00:00Z', sidechain: false, kind: 'edit', file: '/r/src/a.ts', path: 'src/a.ts', change: 'modified', oldText: 'a', newText: 'b', status: 'ok' };
const detail: SessionDetail = {
  session: { id: 's1', title: 'Fix login', slug: 'fix-login', startedAt: null, updatedAt: '2026-10-13T10:00:00Z', version: null, origin: 'terminal', kind: null },
  events: [{ id: 'p1', ts: '', sidechain: false, kind: 'prompt', text: 'Fix login' }, { id: 't1', ts: '', sidechain: false, kind: 'text', text: 'hidden' }, edit],
  touched: [{ path: 'src/a.ts', change: 'modified' }],
};
const impact = { ...scene, id: 'impact-s1', nodes: scene.nodes.map((n, i) => (i === 0 ? { ...n, change: 'modified' as const } : n)) };

const mockApi = (options: { map?: boolean; explainFails?: boolean } = {}) =>
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.endsWith('/sessions')) return [{ id: 's1', title: 'Fix login', slug: 'fix-login', startedAt: null, updatedAt: '2026-10-13T10:00:00Z', version: null, origin: 'terminal', kind: null }, { id: 's2', title: null, slug: null, startedAt: null, updatedAt: '2026-10-13T09:00:00Z', version: null, origin: 'app', kind: 'explain' }] as never;
    if (p.endsWith('/changes')) return { touched: [{ path: 'README.md', change: 'modified' }] } as never;
    if (p.endsWith('/impact')) {
      if (options.map === false) throw new ApiError(404, 'no_system_map');
      return impact as never;
    }
    if (p.endsWith('/impact/explain') && init?.method === 'POST') {
      if (options.explainFails) throw new ApiError(502, 'explain_failed');
      return { scene: { ...impact, id: 'impact-s1-explained' }, text: 'The **store** changed.' } as never;
    }
    throw new Error(`unexpected ${p}`);
  });

const render = () => {
  const openScene = vi.fn();
  const view = renderShell(<SessionsPanel repoId="r1" ctx={{ openScene, selectNode: vi.fn(), selected: null, scene }} />);
  return { openScene, unmount: view.unmount };
};

beforeEach(() => {
  api.mockReset();
  sources.length = 0;
  forgetSessions();
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('SessionsPanel', () => {
  it('lists the working tree entry and the Claude Code sessions', async () => {
    mockApi();
    render();
    expect(await screen.findByTestId('session-s1')).toHaveTextContent('Fix login');
    expect(screen.getByTestId('session-s1')).not.toHaveTextContent('fix-login');
    expect(screen.getByTestId('session-s2')).toHaveTextContent('Explained a change');
    await waitFor(() => expect(screen.getByTestId('session-worktree')).toHaveTextContent('1 files touched'));
  });

  it('opens a session: streams its timeline, overlays the impact and shows the diff of a step', async () => {
    mockApi();
    const { openScene } = render();
    fireEvent.click(await screen.findByTestId('session-s1'));
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0]!.url).toBe('/api/repos/r1/sessions/s1/events');
    act(() => sources[0]!.emit('snapshot', detail));
    expect(screen.getByTestId('session-live')).toBeInTheDocument();
    expect(screen.getByTestId('session-touched')).toHaveTextContent('1 files touched');
    expect(screen.queryByText('hidden')).not.toBeInTheDocument();
    await waitFor(() => expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-s1' }), 'changes'));
    fireEvent.click(screen.getByTestId('event-open-e1'));
    expect(screen.getByTestId('payload-panel')).toHaveTextContent('- a');
    expect(screen.getByTestId('payload-panel')).toHaveTextContent('+ b');
    act(() => sources[0]!.emit('event', { ...edit, id: 'e2', path: 'src/b.ts', status: 'pending' }));
    act(() => sources[0]!.emit('touched', [{ path: 'src/a.ts', change: 'modified' }, { path: 'src/b.ts', change: 'modified' }]));
    expect(screen.getByTestId('event-e2')).toHaveTextContent('pending');
    expect(screen.getByTestId('session-touched')).toHaveTextContent('2 files touched');
    fireEvent.click(screen.getByTestId('session-back'));
    expect(sources[0]!.closed).toBe(true);
  });

  it('explains a change through the agent and reports failures', async () => {
    mockApi();
    const { openScene } = render();
    fireEvent.click(await screen.findByTestId('session-worktree'));
    expect(await screen.findByTestId('touched-README.md')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('session-explain'));
    expect(await screen.findByTestId('session-explanation')).toHaveTextContent('store changed');
    expect(api).toHaveBeenCalledWith('/repos/r1/impact/explain', { method: 'POST', body: {} });
    expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-s1-explained' }), 'changes');
    mockApi({ explainFails: true });
    fireEvent.click(screen.getByTestId('session-explain'));
    expect(await screen.findByRole('alert')).toHaveTextContent('could not explain');
  });

  it('tells the user to draw the map first when there is no system map', async () => {
    mockApi({ map: false });
    render();
    fireEvent.click(await screen.findByTestId('session-worktree'));
    expect(await screen.findByTestId('session-no-map')).toHaveTextContent('Draw the system map first');
  });

  it('remembers the session, the explanation and the scene when the panel is opened again', async () => {
    mockApi();
    const first = render();
    fireEvent.click(await screen.findByTestId('session-s1'));
    await waitFor(() => expect(first.openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-s1' }), 'changes'));
    fireEvent.click(screen.getByTestId('session-explain'));
    await screen.findByTestId('session-explanation');
    first.unmount();
    const again = render();
    await waitFor(() => expect(screen.getByTestId('session-detail')).toHaveTextContent('Fix login'));
    expect(screen.getByTestId('session-explanation')).toHaveTextContent('store changed');
    expect(again.openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-s1-explained' }), 'changes');
  });

  it('upserts events by id', () => {
    const list = upsertEvent([edit], { ...edit, status: 'error' });
    expect(list).toHaveLength(1);
    expect(list[0]!.kind === 'edit' && list[0]!.status).toBe('error');
    expect(upsertEvent([edit], { ...edit, id: 'x' })).toHaveLength(2);
  });
});
