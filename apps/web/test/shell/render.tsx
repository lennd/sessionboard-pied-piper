import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { SESSION_KEY, type SessionData } from '../../src/shell/session';

export const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

export const sessionFixture = (patch: Partial<SessionData> = {}): SessionData => ({
  user: { id: 'u1', email: 'ana@acme.com', name: 'Ana', uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null },
  orgs: [{ id: 'o1', name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'en', defaultExplanationLanguage: 'en', defaultTheme: 'mission' }],
  csrfToken: 'csrf',
  ...patch,
});

export const renderShell = (ui: ReactElement, { route = '/', path = '/', session }: { route?: string; path?: string; session?: SessionData | null } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (session !== undefined) client.setQueryData(SESSION_KEY, session);
  const view = render(
    <I18nProvider initialLanguage="en">
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={[route]}>
          <Routes>
            <Route path={path} element={ui} />
            <Route path="*" element={<LocationProbe />} />
          </Routes>
        </MemoryRouter>
      </QueryClientProvider>
    </I18nProvider>,
  );
  return { client, ...view };
};
