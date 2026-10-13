import { screen } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { SolutionsPage } from '../../src/shell/settings/SolutionsPage';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const render = () =>
  renderShell(<Routes><Route path=":repoId/settings" element={<SettingsLayout />}><Route path="*" element={<SolutionsPage />} /></Route></Routes>, { route: '/repos/r1/settings/solutions', path: '/repos/*', prefs: prefsFixture(), repos: [repoFixture()] });

describe('SolutionsPage', () => {
  beforeEach(() => api.mockReset());

  it('lists solutions with status, version and progress', async () => {
    api.mockResolvedValue([{ id: 's1', title: 'Rate limits', status: 'in_progress', latestVersion: 3, progress: { done: 1, total: 4 }, updatedAt: '2026-10-01T10:00:00Z' }] as never);
    render();
    const row = await screen.findByTestId('solution-s1');
    expect(row).toHaveTextContent('Rate limits');
    expect(row).toHaveTextContent('in progress');
    expect(row).toHaveTextContent('v3');
    expect(row).toHaveTextContent('1 of 4 tasks');
    expect(screen.getByTestId('solution-open-s1')).toHaveAttribute('href', '/repos/r1/solutions/s1');
    expect(screen.getByTestId('nav-solutions')).toBeInTheDocument();
  });

  it('explains how to create the first solution', async () => {
    api.mockResolvedValue([] as never);
    render();
    expect(await screen.findByTestId('solutions-empty')).toHaveTextContent('I want');
  });
});
