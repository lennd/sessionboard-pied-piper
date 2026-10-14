import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { ToolkitPage } from '../../src/shell/settings/ToolkitPage';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('ToolkitPage', () => {
  it('loads, edits and saves the harness description', async () => {
    api.mockImplementation(async (_path, init) => (init?.method === 'PUT' ? { text: (init.body as { text: string }).text.trimEnd() } : { text: 'Run tests with npm test' }) as never);
    renderShell(<Routes><Route path=":repoId/settings" element={<SettingsLayout />}><Route path="*" element={<ToolkitPage />} /></Route></Routes>, { route: '/repos/r1/settings/toolkit', path: '/repos/*', prefs: prefsFixture(), repos: [repoFixture()] });
    await waitFor(() => expect(screen.getByTestId('toolkit-text')).toHaveValue('Run tests with npm test'));
    expect(screen.getByTestId('toolkit-save')).toBeDisabled();
    fireEvent.change(screen.getByTestId('toolkit-text'), { target: { value: 'Install devflow if missing\nRun tests with npm test' } });
    fireEvent.click(screen.getByTestId('toolkit-save'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/toolkit', { method: 'PUT', body: { text: 'Install devflow if missing\nRun tests with npm test' } }));
    expect(await screen.findByTestId('toolkit-saved')).toBeInTheDocument();
    expect(screen.getByTestId('nav-toolkit')).toHaveAttribute('href', '/repos/r1/settings/toolkit');
  });
});
