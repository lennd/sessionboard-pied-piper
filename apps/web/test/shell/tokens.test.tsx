import { fireEvent, screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { TokensPage } from '../../src/shell/settings/TokensPage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('TokensPage', () => {
  it('creates a token shown once and revokes tokens', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { id: 't2', name: 'laptop', prefix: 'rdi_abcdef', token: 'rdi_secret_value', createdAt: '2026-10-01T10:00:00Z' } as never;
      if (init?.method === 'DELETE') return undefined as never;
      return [{ id: 't1', name: 'ci', prefix: 'rdi_123456', lastUsedAt: null, createdAt: '2026-10-01T09:00:00Z' }] as never;
    });
    renderShell(<Routes><Route path=":orgId/settings" element={<SettingsLayout />}><Route path="*" element={<TokensPage />} /></Route></Routes>, { route: '/orgs/o1/settings/tokens', path: '/orgs/*', session: sessionFixture() });
    expect(await screen.findByTestId('token-t1')).toHaveTextContent('rdi_123456');
    expect(screen.getByTestId('token-t1')).toHaveTextContent('never used');
    fireEvent.change(screen.getByTestId('token-name'), { target: { value: 'laptop' } });
    fireEvent.click(screen.getByTestId('token-create'));
    expect(await screen.findByTestId('token-created')).toHaveTextContent('rdi_secret_value');
    expect(api).toHaveBeenCalledWith('/orgs/o1/tokens', { method: 'POST', body: { name: 'laptop' } });
    fireEvent.click(screen.getByTestId('token-revoke-t1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/tokens/t1', { method: 'DELETE' }));
  });
});
