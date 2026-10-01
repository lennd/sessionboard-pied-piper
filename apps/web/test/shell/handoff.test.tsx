import { fireEvent, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { HandoffDialog } from '../../src/shell/solutions/HandoffDialog';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('HandoffDialog', () => {
  it('builds the Claude Code commands and embeds a freshly created token', async () => {
    api.mockImplementation(async (path, init) => {
      if (String(path) === '/mcp-info') return { url: 'http://localhost:4040/mcp', serverName: 'repository-designer' } as never;
      if (init?.method === 'POST') return { id: 'tk', name: 'Claude Code', prefix: 'rdi_abc', token: 'rdi_fresh', createdAt: '2026-10-01T10:00:00Z' } as never;
      return [] as never;
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    renderShell(<HandoffDialog orgId="o1" solutionId="sol" onClose={() => {}} />, { session: sessionFixture() });
    expect(await screen.findByTestId('handoff-mcp-command')).toHaveTextContent('claude mcp add --transport http repository-designer http://localhost:4040/mcp --header "Authorization: Bearer $RDI_TOKEN"');
    expect(screen.getByTestId('handoff-run-command')).toHaveTextContent('call get_solution with id sol');
    fireEvent.click(screen.getByTestId('handoff-create-token'));
    await waitFor(() => expect(screen.getByTestId('handoff-mcp-command')).toHaveTextContent('Bearer rdi_fresh'));
    expect(api).toHaveBeenCalledWith('/orgs/o1/tokens', { method: 'POST', body: { name: 'Claude Code' } });
    fireEvent.click(screen.getByTestId('handoff-copy-run'));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expect.stringContaining('report_task_progress')));
  });
});
