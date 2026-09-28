import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { formatRelative } from '../../src/shell/format';
import { GeneralPage } from '../../src/shell/settings/GeneralPage';
import { MembersPage } from '../../src/shell/settings/MembersPage';
import { PreferencesPage } from '../../src/shell/settings/PreferencesPage';
import { RepositoriesPage } from '../../src/shell/settings/RepositoriesPage';
import { SecurityPage } from '../../src/shell/settings/SecurityPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

const inSettings = (page: React.ReactElement, session = sessionFixture()) =>
  renderShell(
    <Routes>
      <Route path=":orgId/settings" element={<SettingsLayout />}>
        <Route path="*" element={page} />
      </Route>
    </Routes>,
    { route: '/orgs/o1/settings/x', path: '/orgs/*', session },
  );

describe('formatRelative', () => {
  it('formats past times in the locale', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    expect(formatRelative('2026-09-28T11:56:00Z', 'en', now)).toBe('4 minutes ago');
    expect(formatRelative('2026-09-27T12:00:00Z', 'es', now)).toBe('ayer');
    expect(formatRelative(null, 'en', now)).toBeNull();
  });
});

describe('SettingsLayout', () => {
  it('shows navigation, the org switcher and the explore link', () => {
    inSettings(<p>content</p>);
    expect(screen.getByTestId('nav-members')).toHaveAttribute('href', '/orgs/o1/settings/members');
    expect(screen.getByTestId('nav-explore')).toHaveAttribute('href', '/orgs/o1/explore');
    expect(screen.getByTestId('org-switcher')).toHaveValue('o1');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('GeneralPage', () => {
  it('saves org defaults for admins', async () => {
    api.mockResolvedValueOnce({}).mockResolvedValue(sessionFixture());
    inSettings(<GeneralPage />);
    fireEvent.click(screen.getByTestId('general-theme-studio'));
    fireEvent.click(screen.getByTestId('general-save'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1', { method: 'PATCH', body: { name: 'Acme', defaultUiLanguage: 'en', defaultExplanationLanguage: 'en', defaultTheme: 'studio' } }));
    expect(await screen.findByTestId('general-saved')).toBeInTheDocument();
  });

  it('is read-only for members', () => {
    const base = sessionFixture();
    inSettings(<GeneralPage />, { ...base, orgs: [{ ...base.orgs[0]!, role: 'member' }] });
    expect(screen.getByTestId('general-save')).toBeDisabled();
    expect(screen.getByText('Only owners and admins can change these settings.')).toBeInTheDocument();
  });
});

describe('MembersPage', () => {
  const members = {
    members: [
      { userId: 'u1', email: 'ana@acme.com', name: 'Ana', role: 'owner', joinedAt: '2026-09-01T00:00:00Z' },
      { userId: 'u2', email: 'leo@acme.com', name: 'Leo', role: 'member', joinedAt: '2026-09-02T00:00:00Z' },
    ],
    invitations: [{ id: 'i1', email: 'sofi@acme.com', role: 'member', expiresAt: '2026-10-05T00:00:00Z' }],
  };

  it('lists members and pending invitations and sends invitations', async () => {
    api.mockImplementation(async (path, init) => (init?.method === 'POST' ? { id: 'i2', email: 'new@acme.com', role: 'admin', expiresAt: '2026-10-05T00:00:00Z' } : members) as never);
    inSettings(<MembersPage />);
    expect(await screen.findByTestId('member-row-u2')).toHaveTextContent('leo@acme.com');
    expect(screen.getByTestId('member-row-u1')).toHaveTextContent('you');
    expect(screen.getByTestId('invitation-i1')).toHaveTextContent('sofi@acme.com');
    fireEvent.change(screen.getByTestId('invite-email'), { target: { value: 'new@acme.com' } });
    fireEvent.change(screen.getByTestId('invite-role'), { target: { value: 'admin' } });
    fireEvent.click(screen.getByTestId('invite-submit'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/invitations', { method: 'POST', body: { email: 'new@acme.com', role: 'admin' } }));
  });

  it('changes roles and shows server errors', async () => {
    const { ApiError } = await import('../../src/shell/api');
    api.mockImplementation(async (_path, init) => {
      if (init?.method === 'PATCH') throw new ApiError(409, 'last_owner');
      return members as never;
    });
    inSettings(<MembersPage />);
    fireEvent.change(await screen.findByTestId('member-role-u2'), { target: { value: 'admin' } });
    expect(await screen.findByTestId('members-error')).toHaveTextContent('at least one owner');
  });
});

describe('RepositoriesPage', () => {
  it('renders stages per repository and the disabled connect button', async () => {
    api.mockImplementation(async (path) =>
      (String(path).endsWith('/usage')
        ? { repos: 1, repoLimit: 10, pieces: 0 }
        : [{ id: 'r1', fullName: 'acme/orders-api', defaultBranch: 'main', languages: ['TypeScript'], status: 'indexing', lastSyncedAt: null, error: null,
            stages: [{ name: 'clone', status: 'done' }, { name: 'summarize', status: 'running', progress: 64 }, { name: 'link', status: 'pending' }] }]) as never,
    );
    inSettings(<RepositoriesPage />);
    expect(await screen.findByTestId('repo-acme/orders-api')).toHaveTextContent('main');
    expect(screen.getByTestId('stage-acme/orders-api-summarize')).toHaveClass('running');
    expect(screen.getByTestId('stage-acme/orders-api-summarize')).toHaveTextContent('64%');
    expect(screen.getByTestId('connect-github')).toBeDisabled();
    expect(await screen.findByTestId('repos-limit')).toHaveTextContent('1 of 10 repositories');
  });
});

describe('PreferencesPage', () => {
  it('patches the user preference and can reset to the org default', async () => {
    api.mockImplementation(async (_path, init) => ({ ...sessionFixture().user, ...(init?.body as object) }) as never);
    inSettings(<PreferencesPage />);
    fireEvent.click(screen.getByTestId('pref-ui-es'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me', { method: 'PATCH', body: { uiLanguage: 'es' } }));
    fireEvent.click(screen.getByTestId('pref-theme-default'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me', { method: 'PATCH', body: { theme: null } }));
  });
});

describe('SecurityPage', () => {
  it('changes the password and revokes other sessions', async () => {
    api.mockImplementation(async (path, init) => {
      if (path === '/me/sessions' && !init) return [{ id: 's1', createdAt: '2026-09-28T10:00:00Z', lastSeenAt: '2026-09-28T11:00:00Z', userAgent: 'Chrome', ip: '1.1.1.1', current: true }, { id: 's2', createdAt: '2026-09-20T10:00:00Z', lastSeenAt: '2026-09-21T11:00:00Z', userAgent: 'Safari', ip: '2.2.2.2', current: false }] as never;
      return { ok: true } as never;
    });
    inSettings(<SecurityPage />);
    expect(await screen.findByTestId('session-s1')).toHaveTextContent('this device');
    expect(screen.queryByTestId('session-revoke-s1')).toBeNull();
    fireEvent.click(screen.getByTestId('session-revoke-s2'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/me/sessions/s2', { method: 'DELETE' }));
    fireEvent.change(screen.getByTestId('password-current'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByTestId('password-new'), { target: { value: 'fresh passphrase 99' } });
    fireEvent.click(screen.getByTestId('password-submit'));
    expect(await screen.findByTestId('password-updated')).toBeInTheDocument();
  });
});
