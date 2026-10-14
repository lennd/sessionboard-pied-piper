import { fireEvent, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { FeaturesPage } from '../../src/shell/features/FeaturesPage';
import { renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const feature = { id: 'f1', title: 'Checkout 2FA', status: 'draft', repoIds: ['r1', 'r2'], brief: '', createdAt: '2026-10-14T10:00:00Z', updatedAt: '2026-10-14T10:00:00Z', repos: [{ id: 'r1', name: 'shop-api', path: '/a', available: true }, { id: 'r2', name: 'shop-web', path: '/b', available: true }], plan: { id: 'sol', status: 'draft', latestVersion: 1, progress: { done: 1, total: 3 } } };

beforeEach(() => api.mockReset());

describe('FeaturesPage', () => {
  it('lists features with their repositories and plan progress', async () => {
    api.mockImplementation(async (path) => (String(path) === '/features' ? [feature] : [repoFixture()]) as never);
    renderShell(<FeaturesPage />, { route: '/features', path: '/features' });
    const row = await screen.findByTestId('feature-f1');
    expect(row).toHaveTextContent('Checkout 2FA');
    expect(row).toHaveTextContent('shop-api · shop-web');
    expect(row).toHaveTextContent('1 of 3 done');
    expect(screen.getByTestId('feature-open-f1')).toHaveAttribute('href', '/features/f1');
    expect(screen.getByTestId('home-nav-features')).toHaveClass('is-active');
  });

  it('creates a feature from a name, the repositories it touches and a brief', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { ...feature, id: 'f2' } as never;
      return (String(path) === '/features' ? [] : [repoFixture(), repoFixture({ id: 'r2', name: 'shop-web' })]) as never;
    });
    renderShell(<FeaturesPage />, { route: '/features', path: '/features' });
    expect(await screen.findByTestId('features-empty')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('features-new'));
    expect(screen.getByTestId('feature-create-submit')).toBeDisabled();
    fireEvent.change(screen.getByTestId('feature-create-title'), { target: { value: 'Checkout 2FA' } });
    fireEvent.click(await screen.findByTestId('feature-create-repo-r1'));
    fireEvent.click(screen.getByTestId('feature-create-repo-r2'));
    fireEvent.change(screen.getByTestId('feature-create-brief'), { target: { value: 'Add 2FA' } });
    fireEvent.click(screen.getByTestId('feature-create-submit'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/features', { method: 'POST', body: { title: 'Checkout 2FA', repoIds: ['r1', 'r2'], brief: 'Add 2FA' } }));
    await waitFor(() => expect(screen.queryByTestId('feature-create')).not.toBeInTheDocument());
  });
});
