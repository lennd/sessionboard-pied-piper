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

const gh = (patch: object = {}) => ({ configured: false, source: null, appSlug: null, appUrl: null, manifestAvailable: false, installations: [], ...patch });

const mockApi = (state: { integrations: object; available: object[]; repos: object[] }, onMutation: (path: string, init: { method?: string; body?: unknown }) => unknown = () => ({})) =>
  api.mockImplementation(async (path, init) => {
    if (init?.method && init.method !== 'GET') return onMutation(String(path), init) as never;
    if (String(path).endsWith('/integrations')) return state.integrations as never;
    if (String(path).endsWith('/available-repos')) return state.available as never;
    if (String(path).endsWith('/usage')) return { repos: state.repos.length, repoLimit: 10, pieces: 0 } as never;
    if (String(path).includes('/github/manifest')) return { action: 'https://github.com/organizations/lennd/settings/apps/new?state=st', manifest: '{"name":"My App"}' } as never;
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
    mockApi({ integrations: { github: gh(), demo: { available: true } }, available: [{ fullName: 'acme-demo/shop-api', defaultBranch: 'main', source: 'demo' }], repos: [] }, onMutation);
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
    mockApi({ integrations: { github: gh({ configured: true, source: 'env', appSlug: 'x' }), demo: { available: false } }, available: [], repos: [] });
    render();
    const connect = await screen.findByTestId('connect-github');
    await waitFor(() => expect(connect).toBeEnabled());
    fireEvent.click(connect);
    await waitFor(() => expect(assign).toHaveBeenCalledWith('https://github.com/apps/x/installations/new?state=s'));
  });

  it('shows the connected account and the post-install toast', async () => {
    mockApi({ integrations: { github: gh({ configured: true, source: 'env', appSlug: 'x', installations: [{ accountLogin: 'acme' }] }), demo: { available: false } }, available: [], repos: [] });
    render('/orgs/o1/settings/repositories?connected=github');
    expect(await screen.findByTestId('github-account-acme')).toHaveTextContent('acme');
    expect(screen.getByTestId('connected-toast')).toBeInTheDocument();
  });

  it('renders stages, re-indexes, removes and reports errors', async () => {
    const onMutation = vi.fn((path: string, init: { method?: string }) => {
      if (init.method === 'DELETE') throw new ApiError(403, 'forbidden');
      return {};
    });
    mockApi({
      integrations: { github: gh(), demo: { available: true } },
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

  it('creates the GitHub App through the manifest flow for an organization', async () => {
    const submit = vi.spyOn(HTMLFormElement.prototype, 'submit').mockImplementation(function (this: HTMLFormElement) {
      document.body.dataset.submitted = `${this.method}|${this.action}|${(this.elements.namedItem('manifest') as HTMLInputElement).value}`;
    });
    mockApi({ integrations: { github: gh({ manifestAvailable: true }), demo: { available: true } }, available: [], repos: [] });
    render();
    fireEvent.change(await screen.findByTestId('app-name'), { target: { value: 'My App' } });
    fireEvent.change(screen.getByTestId('app-owner'), { target: { value: 'org' } });
    fireEvent.change(screen.getByTestId('app-org-login'), { target: { value: 'lennd' } });
    fireEvent.click(screen.getByTestId('create-app-submit'));
    await waitFor(() => expect(submit).toHaveBeenCalled());
    expect(api).toHaveBeenCalledWith('/orgs/o1/github/manifest?owner=org&org=lennd&name=My+App');
    expect(document.body.dataset.submitted).toBe('post|https://github.com/organizations/lennd/settings/apps/new?state=st|{"name":"My App"}');
    submit.mockRestore();
  });

  it('lists every connected account and lets the user connect another one', async () => {
    mockApi({
      integrations: { github: gh({ configured: true, source: 'manifest', appSlug: 'rd', appUrl: 'https://github.com/apps/rd', installations: [{ accountLogin: 'hugo' }, { accountLogin: 'lennd' }] }), demo: { available: false } },
      available: [{ fullName: 'lennd/api', defaultBranch: 'develop', source: 'github', account: 'lennd' }],
      repos: [],
    });
    render();
    expect(await screen.findByTestId('github-account-hugo')).toBeInTheDocument();
    expect(screen.getByTestId('github-account-lennd')).toBeInTheDocument();
    expect(screen.getByTestId('connect-github')).toHaveTextContent('Connect another account');
    expect(await screen.findByRole('option', { name: 'lennd/api · GitHub (lennd)' })).toBeInTheDocument();
    expect(screen.queryByTestId('create-app')).toBeNull();
  });
});

