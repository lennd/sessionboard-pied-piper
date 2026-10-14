import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { RulesPage } from '../../src/shell/settings/RulesPage';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const render = () =>
  renderShell(<Routes><Route path=":repoId/settings" element={<SettingsLayout />}><Route path="*" element={<RulesPage />} /></Route></Routes>, { route: '/repos/r1/settings/rules', path: '/repos/*', prefs: prefsFixture(), repos: [repoFixture()] });

describe('RulesPage', () => {
  beforeEach(() => api.mockReset());

  it('loads the rules, enables save on change and stores them', async () => {
    api.mockImplementation(async (_path, init) => (init?.method === 'PUT' ? { text: (init.body as { text: string }).text.trimEnd(), count: 2 } : { text: 'No raw SQL', count: 1 }) as never);
    render();
    await waitFor(() => expect(screen.getByTestId('rules-text')).toHaveValue('No raw SQL'));
    expect(screen.getByTestId('rules-count')).toHaveTextContent('1 rules');
    expect(screen.getByTestId('rules-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('rules-text'), { target: { value: 'No raw SQL\nEvery endpoint validates its body\n' } });
    expect(screen.getByTestId('rules-save')).toBeEnabled();
    fireEvent.click(screen.getByTestId('rules-save'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/rules', { method: 'PUT', body: { text: 'No raw SQL\nEvery endpoint validates its body\n' } }));
    expect(await screen.findByTestId('rules-saved')).toBeInTheDocument();
    expect(screen.getByTestId('rules-count')).toHaveTextContent('2 rules');
    expect(screen.getByTestId('nav-rules')).toHaveAttribute('href', '/repos/r1/settings/rules');
  });
});
