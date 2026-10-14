import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { formatRelative } from '../../src/shell/format';
import { PreferencesPage } from '../../src/shell/settings/PreferencesPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

const inSettings = (page: React.ReactElement, prefs = prefsFixture()) =>
  renderShell(
    <Routes>
      <Route path=":repoId/settings" element={<SettingsLayout />}>
        <Route path="*" element={page} />
      </Route>
    </Routes>,
    { route: '/repos/r1/settings/x', path: '/repos/*', prefs, repos: [repoFixture()] },
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
  it('shows the repository, its navigation and the links back and to explore', () => {
    inSettings(<p>content</p>);
    expect(screen.getByTestId('repo-name')).toHaveTextContent('shop-api');
    expect(screen.getByTestId('nav-preferences')).toHaveAttribute('href', '/repos/r1/settings/preferences');
    expect(screen.getByTestId('nav-solutions')).toHaveAttribute('href', '/repos/r1/settings/solutions');
    expect(screen.getByTestId('nav-explore')).toHaveAttribute('href', '/repos/r1/explore');
    expect(screen.getByTestId('nav-repos')).toHaveAttribute('href', '/');
    expect(screen.getByText('content')).toBeInTheDocument();
  });
});

describe('PreferencesPage', () => {
  it('shows the stored preferences and patches them', async () => {
    api.mockResolvedValue(prefsFixture({ theme: 'paper' }) as never);
    inSettings(<PreferencesPage />, prefsFixture({ uiLanguage: 'es' }));
    expect(screen.getByTestId('pref-ui-es')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('pref-theme-default')).toHaveTextContent('Default (Piper');
    fireEvent.click(screen.getByTestId('pref-theme-paper'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/prefs', { method: 'PATCH', body: { theme: 'paper' } }));
  });
});
