import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { apiFetch } from '../../src/shell/api';
import { PullsPanel } from '../../src/shell/pulls/PullsPanel';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const scene = { ...sampleRegistry['iot-telemetry']!, id: 'pr-hugo-notes-5', title: '#5 Logout', nodes: sampleRegistry['iot-telemetry']!.nodes.map((n, i) => (i === 0 ? { ...n, change: 'modified' as const } : n)) };
const pull = (n: number, extra = {}) => ({ number: n, title: `Change ${n}`, author: 'ana', draft: n === 6, headRef: `feature/${n}`, baseRef: 'main', updatedAt: '2026-10-01T10:00:00Z', url: `https://github.com/hugo/notes/pull/${n}`, ...extra });
const ctx = () => ({ openScene: vi.fn(), selectNode: vi.fn(), selected: null, scene, ask: vi.fn() });

const mockApi = (list: object) =>
  api.mockImplementation(async (path) => {
    const p = String(path);
    if (p.startsWith('/orgs/o1/pulls/hugo/notes/5')) {
      return { pull: pull(5, { body: 'Adds **SSO** logout', additions: 12, deletions: 3, changedFiles: 2 }), files: [{ filename: 'src/auth/sso.ts', status: 'modified', additions: 10, deletions: 3 }, { filename: 'src/new.ts', status: 'added', additions: 2, deletions: 0 }], scene } as never;
    }
    return list as never;
  });

beforeEach(() => api.mockReset());

describe('PullsPanel', () => {
  it('lists open pull requests per repository and flags unavailable repositories', async () => {
    mockApi({ configured: true, repos: [{ repo: 'hugo/notes', status: 'ok', pulls: [pull(5), pull(6)] }, { repo: 'lennd/api', status: 'unavailable', pulls: [] }] });
    renderShell(<PullsPanel orgId="o1" ctx={ctx()} />, { session: sessionFixture() });
    expect(await screen.findByTestId('pull-hugo/notes#5')).toHaveTextContent('Change 5');
    expect(screen.getByTestId('pull-hugo/notes#5')).toHaveTextContent('feature/5 → main');
    expect(screen.getByTestId('pull-hugo/notes#6')).toHaveTextContent('Draft');
    expect(screen.getByTestId('pulls-repo-lennd/api')).toHaveTextContent('could not be read');
  });

  it('opens a pull request as a change diagram with its files, description and an agent review', async () => {
    mockApi({ configured: true, repos: [{ repo: 'hugo/notes', status: 'ok', pulls: [pull(5)] }] });
    const context = ctx();
    renderShell(<PullsPanel orgId="o1" ctx={context} />, { session: sessionFixture() });
    fireEvent.click(await screen.findByTestId('pull-hugo/notes#5'));
    await waitFor(() => expect(context.openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'pr-hugo-notes-5' }), 'changes'));
    expect(api).toHaveBeenCalledWith('/orgs/o1/pulls/hugo/notes/5');
    const detail = await screen.findByTestId('pull-detail');
    expect(detail).toHaveTextContent('+12 −3');
    expect(screen.getByTestId('pull-file-src/auth/sso.ts')).toHaveTextContent('modified');
    expect(detail.querySelector('strong')).toHaveTextContent('SSO');
    expect(screen.getByTestId('pull-github')).toHaveAttribute('href', 'https://github.com/hugo/notes/pull/5');
    fireEvent.click(screen.getByTestId('pull-review'));
    expect(context.ask).toHaveBeenCalledWith(expect.stringMatching(/^Review pull request hugo\/notes#5/), 'analyze');
    fireEvent.click(screen.getByTestId('pull-back'));
    expect(screen.getByTestId('pull-hugo/notes#5')).toBeInTheDocument();
  });

  it('explains when GitHub is not connected or nothing is open, and refreshes on demand', async () => {
    mockApi({ configured: false, repos: [] });
    const { unmount } = renderShell(<PullsPanel orgId="o1" ctx={ctx()} />, { session: sessionFixture() });
    expect(await screen.findByTestId('pulls-not-configured')).toHaveTextContent('Connect GitHub');
    unmount();
    mockApi({ configured: true, repos: [{ repo: 'hugo/notes', status: 'ok', pulls: [] }] });
    renderShell(<PullsPanel orgId="o1" ctx={ctx()} />, { session: sessionFixture() });
    expect(await screen.findByTestId('pulls-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('pulls-refresh'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/pulls?refresh=1'));
  });
});
