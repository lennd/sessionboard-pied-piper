import { fireEvent, screen, waitFor } from '@testing-library/react';
import { apiFetch } from '../../src/shell/api';
import { ReviewsPage } from '../../src/shell/reviews/ReviewsPage';
import { renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const pull = (number: number, title: string, headRef: string) => ({ number, title, headRef, author: 'ana', draft: false, baseRef: 'main', updatedAt: '', url: '', additions: 1, deletions: 0, changedFiles: 1, review: { decision: 'pending', approvedByMe: false, approvals: 0, changesRequested: 0 } });

beforeEach(() => {
  api.mockReset();
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p === '/reviews' && init?.method === 'POST') return { id: 'rv1', title: 'shop-api #7 + shop-web #9', selections: (init.body as { selections: unknown[] }).selections, parts: [], explainedAt: null, createdAt: '', updatedAt: '' } as never;
    if (p === '/reviews') return [{ id: 'rv0', title: 'Old review', selections: [], parts: [{ repoId: 'r1', name: 'shop-api', pull: 4, available: true, url: null }], explainedAt: '2026-10-14T10:00:00Z', createdAt: '', updatedAt: '2026-10-14T10:00:00Z' }] as never;
    if (p.startsWith('/reviews/suggest')) return { repos: [{ repoId: 'r1', name: 'shop-api', pulls: [pull(7, 'Store rewrite', 'feature/store'), pull(8, 'Solo', 'chore/x')], branch: null }, { repoId: 'r2', name: 'shop-web', pulls: [pull(9, 'Store UI', 'feature/store')], branch: { branch: 'feature/local', base: 'main', ahead: 2 } }], matches: [{ headRef: 'feature/store', pulls: [{ repoId: 'r1', number: 7, title: 'Store rewrite' }, { repoId: 'r2', number: 9, title: 'Store UI' }] }] } as never;
    if (p === '/repos') return [repoFixture(), repoFixture({ id: 'r2', name: 'shop-web' })] as never;
    return {} as never;
  });
});

describe('ReviewsPage', () => {
  it('lists reviews and builds one from the pull requests that share a branch', async () => {
    renderShell(<ReviewsPage />, { route: '/reviews', path: '/reviews' });
    expect(await screen.findByTestId('review-rv0')).toHaveTextContent('Old review');
    fireEvent.click(screen.getByTestId('reviews-new'));
    fireEvent.click(screen.getByTestId('review-create-repo-r1'));
    fireEvent.click(screen.getByTestId('review-create-repo-r2'));
    expect(await screen.findByTestId('review-matches')).toHaveTextContent('feature/store');
    expect(screen.getByTestId('review-create-submit')).toBeDisabled();
    fireEvent.click(screen.getByTestId('review-match-feature/store'));
    expect(screen.getByTestId('review-create-pull-r1')).toHaveValue('7');
    expect(screen.getByTestId('review-create-pull-r2')).toHaveValue('9');
    expect(screen.getByTestId('review-create-submit')).not.toBeDisabled();
    fireEvent.click(screen.getByTestId('review-create-submit'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/reviews', { method: 'POST', body: { selections: [{ repoId: 'r1', pull: 7 }, { repoId: 'r2', pull: 9 }] } }));
  });

  it('lets a repository contribute its current branch instead of a pull request', async () => {
    renderShell(<ReviewsPage />, { route: '/reviews?new=1', path: '/reviews' });
    fireEvent.click(await screen.findByTestId('review-create-repo-r2'));
    const select = await screen.findByTestId('review-create-pull-r2');
    fireEvent.change(select, { target: { value: 'branch' } });
    fireEvent.click(screen.getByTestId('review-create-submit'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/reviews', { method: 'POST', body: { selections: [{ repoId: 'r2', pull: 'branch' }] } }));
  });
});
