import { screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { HomePage } from '../../src/shell/pages/HomePage';
import { renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

describe('HomePage', () => {
  it('shows the mark, the name and the three doors with live counts', async () => {
    api.mockImplementation(async (path) => (String(path) === '/repos' ? [repoFixture(), repoFixture({ id: 'r2' })] : []) as never);
    renderShell(<HomePage />);
    expect(screen.getByTestId('home')).toHaveTextContent('pied piper');
    expect(screen.getByTestId('home').querySelector('.piper-mark')).not.toBeNull();
    expect(screen.getByTestId('home-repos')).toHaveAttribute('href', '/repos');
    expect(screen.getByTestId('home-new-feature')).toHaveAttribute('href', '/features?new=1');
    expect(screen.getByTestId('home-settings')).toHaveAttribute('href', '/settings');
    await waitFor(() => expect(screen.getByTestId('home-repos')).toHaveTextContent('2 registered'));
  });
});
