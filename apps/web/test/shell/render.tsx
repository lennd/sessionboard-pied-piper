import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import type { ReactElement } from 'react';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { PREFS_KEY, repoKey, REPOS_KEY, type Prefs, type RepoInfo } from '../../src/shell/local';

export const LocationProbe = () => {
  const location = useLocation();
  return <div data-testid="location">{location.pathname}{location.search}</div>;
};

export const prefsFixture = (patch: Partial<Prefs> = {}): Prefs => ({ uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null, ...patch });
export const repoFixture = (patch: Partial<RepoInfo> = {}): RepoInfo => ({ id: 'r1', name: 'shop-api', path: '/tmp/shop-api', addedAt: '2026-10-13T10:00:00Z', head: 'abcdef1234567', branch: 'main', hasSystemMap: false, ...patch });

export const renderShell = (ui: ReactElement, { route = '/', path = '/', prefs, repos }: { route?: string; path?: string; prefs?: Prefs; repos?: RepoInfo[] } = {}) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  if (prefs) client.setQueryData(PREFS_KEY, prefs);
  if (repos) {
    client.setQueryData(REPOS_KEY, repos);
    for (const repo of repos) client.setQueryData(repoKey(repo.id), repo);
  }
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
