import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { useI18n } from '../../src/i18n/I18nProvider';
import { apiFetch } from '../../src/shell/api';
import { Shell } from '../../src/shell/guards';
import { prefsFixture, renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
beforeEach(() => vi.mocked(apiFetch).mockReset());

const LanguageProbe = () => <div data-testid="lang">{useI18n().language}</div>;
const shell = (
  <Routes>
    <Route element={<Shell />}>
      <Route path="*" element={<LanguageProbe />} />
    </Route>
  </Routes>
);

describe('Shell', () => {
  it('renders children and applies the stored UI language', async () => {
    vi.mocked(apiFetch).mockResolvedValue(prefsFixture({ uiLanguage: 'pt' }) as never);
    renderShell(shell, { route: '/x', path: '/*' });
    await waitFor(() => expect(screen.getByTestId('lang')).toHaveTextContent('pt'));
  });

  it('keeps the current language when no preference is stored', async () => {
    vi.mocked(apiFetch).mockResolvedValue(prefsFixture() as never);
    renderShell(shell, { route: '/x', path: '/*' });
    await waitFor(() => expect(vi.mocked(apiFetch)).toHaveBeenCalledWith('/prefs'));
    expect(screen.getByTestId('lang')).toHaveTextContent('en');
  });
});
