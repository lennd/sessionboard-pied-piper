import { fireEvent, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { HandoffDialog } from '../../src/shell/solutions/HandoffDialog';
import { renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('HandoffDialog', () => {
  it('builds the Claude Code commands for the local MCP server', async () => {
    api.mockResolvedValue({ url: 'http://127.0.0.1:4040/mcp/r1', serverName: 'rdi' } as never);
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
});
