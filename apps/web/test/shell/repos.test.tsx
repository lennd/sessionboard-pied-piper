import { fireEvent, screen, waitFor } from '@testing-library/react';
import { ApiError, apiFetch } from '../../src/shell/api';
import { ReposPage } from '../../src/shell/pages/ReposPage';
import { renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => {
  api.mockReset();
  delete window.rdi;
});

describe('ReposPage', () => {
  it('lists repositories with git state and map status', async () => {
    api.mockResolvedValue([repoFixture(), repoFixture({ id: 'r2', name: 'notes', head: null, branch: null, hasSystemMap: true })] as never);
    renderShell(<ReposPage />, { route: '/repos', path: '/repos' });
    const row = await screen.findByTestId('repo-r1');
    expect(row).toHaveTextContent('shop-api');
    expect(row).toHaveTextContent('main · abcdef1');
    expect(row).toHaveTextContent('no map yet');
    expect(screen.getByTestId('repo-open-r1')).toHaveAttribute('href', '/repos/r1/explore');
    expect(screen.getByTestId('repo-r2')).toHaveTextContent('not a git repository');
    expect(screen.getByTestId('repo-r2')).toHaveTextContent('map ready');
    expect(screen.queryByTestId('repos-browse')).not.toBeInTheDocument();
  });

  it('adds a folder by path and reports bad paths', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') {
        if ((init.body as { path: string }).path === '/nope') throw new ApiError(400, 'not_a_directory');
        return repoFixture() as never;
      }
      return [] as never;
    });
    renderShell(<ReposPage />, { route: '/repos', path: '/repos' });
    expect(await screen.findByTestId('repos-empty')).toBeInTheDocument();
    fireEvent.change(screen.getByTestId('repos-path'), { target: { value: '/nope' } });
    fireEvent.click(screen.getByTestId('repos-add'));
    expect(await screen.findByTestId('repos-error')).toHaveTextContent('not a folder');
    fireEvent.change(screen.getByTestId('repos-path'), { target: { value: '/tmp/shop-api' } });
    fireEvent.click(screen.getByTestId('repos-add'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos', { method: 'POST', body: { path: '/tmp/shop-api' } }));
    await waitFor(() => expect(screen.getByTestId('repos-path')).toHaveValue(''));
  });

  it('uses the desktop folder picker when available and removes repositories', async () => {
    window.rdi = { pickFolder: vi.fn().mockResolvedValue('/picked'), openExternal: vi.fn() };
    api.mockImplementation(async (_path, init) => (init?.method === 'POST' ? repoFixture({ id: 'r9', path: '/picked' }) : init?.method === 'DELETE' ? undefined : [repoFixture()]) as never);
    renderShell(<ReposPage />, { route: '/repos', path: '/repos' });
    fireEvent.click(await screen.findByTestId('repos-browse'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos', { method: 'POST', body: { path: '/picked' } }));
    fireEvent.click(screen.getByTestId('repo-remove-r1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1', { method: 'DELETE' }));
  });
});
