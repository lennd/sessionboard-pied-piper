import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, apiFetch } from '../../src/shell/api';
import { HandoffDialog } from '../../src/shell/solutions/HandoffDialog';
import { permissionLabel } from '../../src/shell/solutions/runsApi';
import { renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const sources: FakeEventSource[] = [];
class FakeEventSource {
  listeners: Record<string, (e: { data: string }) => void> = {};
  closed = false;
  constructor(public url: string) { sources.push(this); }
  addEventListener(type: string, fn: (e: { data: string }) => void) { this.listeners[type] = fn; }
  close() { this.closed = true; }
  emit(data: unknown) { this.listeners.run?.({ data: JSON.stringify(data) }); }
}
const info = { url: 'http://127.0.0.1:4040/mcp/r1', serverName: 'rdi' };

beforeEach(() => {
  api.mockReset();
  sources.length = 0;
  vi.stubGlobal('EventSource', FakeEventSource);
});
afterEach(() => vi.unstubAllGlobals());

describe('HandoffDialog', () => {
  it('builds the Claude Code commands for the local MCP server', async () => {
    api.mockResolvedValue(info as never);
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell(<HandoffDialog repoId="r1" solutionId="sol" onClose={() => {}} />);
    expect(await screen.findByTestId('handoff-mcp-command')).toHaveTextContent('claude mcp add --transport http rdi http://127.0.0.1:4040/mcp/r1');
    expect(screen.getByTestId('handoff-mcp-command')).not.toHaveTextContent('Bearer');
    expect(api).toHaveBeenCalledWith('/repos/r1/mcp-info');
    expect(screen.getByTestId('handoff-run-command')).toHaveTextContent('call get_solution with id sol');
    fireEvent.click(screen.getByTestId('handoff-copy-run'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('report_task_progress')));
  });

  it('runs the solution here: streams the log, lets the user answer permission requests and stop', async () => {
    api.mockImplementation(async (path, init) => {
      if (String(path).endsWith('/mcp-info')) return info as never;
      if (String(path).endsWith('/run')) return { id: 'run1', solutionId: 'sol', status: 'running', startedAt: '', endedAt: null, pending: [] } as never;
      if (init?.method === 'POST') return undefined as never;
      throw new Error(`unexpected ${String(path)}`);
    });
    renderShell(<HandoffDialog repoId="r1" solutionId="sol" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('handoff-run-here'));
    expect(await screen.findByTestId('run-view')).toBeInTheDocument();
    expect(api).toHaveBeenCalledWith('/repos/r1/solutions/sol/run', { method: 'POST', body: {} });
    await waitFor(() => expect(sources).toHaveLength(1));
    expect(sources[0]!.url).toBe('/api/repos/r1/runs/run1/events');
    act(() => {
      sources[0]!.emit({ type: 'status', status: 'running' });
      sources[0]!.emit({ type: 'text', delta: 'Reading. ' });
      sources[0]!.emit({ type: 'tool', name: 'Bash', status: 'running', summary: 'Bash npm test' });
      sources[0]!.emit({ type: 'permission', id: 'p1', tool: 'Bash', input: { command: 'npm test' }, description: 'Run the tests' });
    });
    expect(screen.getByTestId('run-log')).toHaveTextContent('Reading.');
    expect(screen.getByTestId('run-permission-p1')).toHaveTextContent('Claude wants to use Bash');
    expect(screen.getByTestId('run-permission-p1')).toHaveTextContent('Bash: npm test');
    fireEvent.click(screen.getByTestId('run-allow-p1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/runs/run1/permissions/p1', { method: 'POST', body: { allow: true } }));
    act(() => {
      sources[0]!.emit({ type: 'permission_resolved', id: 'p1', allow: true });
      sources[0]!.emit({ type: 'tool', name: 'Bash', status: 'done', summary: 'Bash' });
    });
    expect(screen.queryByTestId('run-permission-p1')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('run-stop'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/runs/run1/cancel', { method: 'POST', body: {} }));
    act(() => sources[0]!.emit({ type: 'status', status: 'cancelled', message: 'The run was stopped by the user.' }));
    expect(screen.getByTestId('run-status')).toHaveTextContent('stopped');
    expect(screen.getByTestId('run-message')).toHaveTextContent('stopped by the user');
    expect(screen.queryByTestId('run-stop')).not.toBeInTheDocument();
  });

  it('reports when a run cannot start', async () => {
    api.mockImplementation(async (path) => {
      if (String(path).endsWith('/mcp-info')) return info as never;
      throw new ApiError(409, 'already_running');
    });
    renderShell(<HandoffDialog repoId="r1" solutionId="sol" onClose={() => {}} />);
    fireEvent.click(await screen.findByTestId('handoff-run-here'));
    expect(await screen.findByRole('alert')).toHaveTextContent('already in progress');
    expect(permissionLabel({ type: 'permission', id: 'x', tool: 'Read', input: { file_path: '/a' }, description: null })).toBe('Read: /a');
  });
});
