import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { useI18n } from '../../src/i18n/I18nProvider';
import { apiFetch } from '../../src/shell/api';
import { HomeRedirect, RequireAuth } from '../../src/shell/guards';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());

const LanguageProbe = () => <div data-testid="lang">{useI18n().language}</div>;

describe('HomeRedirect', () => {
  it('sends anonymous users to sign in', async () => {
    renderShell(<HomeRedirect />, { session: null });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login'));
  });

  it('sends users without orgs to onboarding and others to their first org', async () => {
    renderShell(<HomeRedirect />, { session: sessionFixture({ orgs: [] }) });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/onboarding'));
  });

  it('opens the first organization workspace', async () => {
    renderShell(<HomeRedirect />, { session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/explore'));
  });
});

describe('RequireAuth', () => {
  const guarded = (
    <Routes>
      <Route element={<RequireAuth />}>
        <Route path="*" element={<LanguageProbe />} />
      </Route>
    </Routes>
  );

  it('redirects anonymous users with a return path', async () => {
    vi.mocked(apiFetch).mockResolvedValue(null);
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session: null });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?next=%2Forgs%2Fo1%2Fsettings'));
  });

  it('renders children and applies the org default language', async () => {
    const session = sessionFixture({ orgs: [{ ...sessionFixture().orgs[0]!, defaultUiLanguage: 'es' }] });
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session });
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('es'));
  });

  it('prefers the user language over the org default', async () => {
    const base = sessionFixture();
    const session = { ...base, user: { ...base.user, uiLanguage: 'pt' as const }, orgs: [{ ...base.orgs[0]!, defaultUiLanguage: 'es' as const }] };
    renderShell(guarded, { route: '/orgs/o1/settings', path: '/orgs/*', session });
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('pt'));
  });
});
