import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { ApiError, apiFetch } from '../../src/shell/api';
import { RepositoriesPage } from '../../src/shell/settings/RepositoriesPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

const repo = (fullName: string, status: string, stages: { name: string; status: string; progress?: number }[]) =>
  ({ id: fullName, fullName, defaultBranch: 'main', languages: ['TypeScript'], status, stages, error: null, lastSyncedAt: null });

const mockApi = (state: { integrations: object; available: object[]; repos: object[] }, onMutation: (path: string, init: { method?: string; body?: unknown }) => unknown = () => ({})) =>
  api.mockImplementation(async (path, init) => {
    if (init?.method && init.method !== 'GET') return onMutation(String(path), init) as never;
    if (String(path).endsWith('/integrations')) return state.integrations as never;
    if (String(path).endsWith('/available-repos')) return state.available as never;
    if (String(path).endsWith('/usage')) return { repos: state.repos.length, repoLimit: 10, pieces: 0 } as never;
    if (String(path).endsWith('/github/install-url')) return { url: 'https://github.com/apps/x/installations/new?state=s' } as never;
    return state.repos as never;
  });

const render = (route = '/orgs/o1/settings/repositories') =>
  renderShell(
    <Routes>
      <Route path=":orgId/settings" element={<SettingsLayout />}>
        <Route path="*" element={<RepositoriesPage />} />
      </Route>
    </Routes>,
    { route, path: '/orgs/*', session: sessionFixture() },
  );

beforeEach(() => api.mockReset());

describe('RepositoriesPage', () => {
  it('offers the demo repositories when GitHub is not configured and adds one', async () => {
    const onMutation = vi.fn(() => ({}));
    mockApi({ integrations: { github: { configured: false, installation: null }, demo: { available: true } }, available: [{ fullName: 'acme-demo/shop-api', defaultBranch: 'main', source: 'demo' }], repos: [] }, onMutation);
    render();
    expect(await screen.findByTestId('demo-hint')).toBeInTheDocument();
    expect(screen.getByTestId('connect-github')).toBeDisabled();
    await screen.findByRole('option', { name: /acme-demo\/shop-api/ });
    fireEvent.click(screen.getByTestId('add-repo-submit'));
    await waitFor(() => expect(onMutation).toHaveBeenCalledWith('/orgs/o1/repos', { method: 'POST', body: { fullName: 'acme-demo/shop-api' } }));
  });

  it('starts the GitHub install when configured and shows the connected account', async () => {
    const assign = vi.fn();
    Object.defineProperty(window, 'location', { value: { ...window.location, assign }, writable: true });
    mockApi({ integrations: { github: { configured: true, installation: null }, demo: { available: false } }, available: [], repos: [] });
    render();
    const connect = await screen.findByTestId('connect-github');
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/x/installations/new?state=s'));
  });

  it('shows the connected account and the post-install toast', async () => {
    mockApi({ integrations: { github: { configured: true, installation: { accountLogin: 'acme' } }, demo: { available: false } }, available: [], repos: [] });
    render('/orgs/o1/settings/repositories?connected=github');
    expect(await screen.findByTestId('github-connected')).toHaveTextContent('Connected to acme');
    expect(screen.getByTestId('connected-toast')).toBeInTheDocument();
  });

  it('renders stages, re-indexes, removes and reports errors', async () => {
    const onMutation = vi.fn((path: string, init: { method?: string }) => {
      if (init.method === 'DELETE') throw new ApiError(403, 'forbidden');
      return {};
    });
    mockApi({
      integrations: { github: { configured: false, installation: null }, demo: { available: true } },
      available: [],
      repos: [repo('acme-demo/shop-api', 'indexing', [{ name: 'clone', status: 'done' }, { name: 'summarize', status: 'running', progress: 64 }]), repo('acme-demo/shop-web', 'ready', [])],
    }, onMutation);
    render();
    expect(await screen.findByTestId('stage-acme-demo/shop-api-summarize')).toHaveTextContent('64%');
    expect(screen.getByText('Every available repository is already added.')).toBeInTheDocument();
    expect(screen.getByTestId('repo-reindex-acme-demo/shop-api')).toBeDisabled();
    fireEvent.click(screen.getByTestId('repo-reindex-acme-demo/shop-web'));
    await waitFor(() => expect(onMutation).toHaveBeenCalledWith('/orgs/o1/repos/acme-demo/shop-web/reindex', { method: 'POST', body: {} }));
    fireEvent.click(screen.getByTestId('repo-remove-acme-demo/shop-api'));
    expect(await screen.findByTestId('repos-error')).toHaveTextContent('permission');
  });
});
