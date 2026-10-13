import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { ExplorePage } from '../../src/shell/pages/ExplorePage';
import { prefsFixture, renderShell, repoFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes }: { extraScenes?: { id: string }[] }) => <div data-testid="workspace">{(extraScenes ?? []).map((s) => s.id).join(',') || 'samples-only'}</div>,
}));
const api = vi.mocked(apiFetch);
const map = { ...sampleRegistry['iot-telemetry']!, id: 'system-map', title: 'System map' };
const open = () => renderShell(<ExplorePage />, { route: '/repos/r1/explore', path: '/repos/:repoId/explore', prefs: prefsFixture(), repos: [repoFixture()] });
beforeEach(() => api.mockReset());

describe('ExplorePage', () => {
  it('passes the cached system map to the workspace', async () => {
    api.mockResolvedValue(map as never);
    open();
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('system-map'));
    expect(api).toHaveBeenCalledWith('/repos/r1/system-map');
    expect(screen.queryByTestId('explore-no-map')).not.toBeInTheDocument();
  });

  it('offers to draw the map when there is none and shows it once generated', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') return { scene: map, cached: false } as never;
      if (String(path).endsWith('/system-map')) throw new ApiError(404, 'not_found');
      return repoFixture() as never;
    });
    open();
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only'));
    expect(screen.getByTestId('explore-no-map')).toHaveTextContent('no map of this repository');
    fireEvent.click(screen.getByTestId('explore-generate'));
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('system-map'));
    expect(api).toHaveBeenCalledWith('/repos/r1/system-map', { method: 'POST', body: { language: 'en' } });
    expect(screen.queryByTestId('explore-no-map')).not.toBeInTheDocument();
  });

  it('reports when Claude could not draw the map', async () => {
    api.mockImplementation(async (path, init) => {
      if (init?.method === 'POST') throw new ApiError(502, 'map_failed');
      if (String(path).endsWith('/system-map')) throw new ApiError(404, 'not_found');
      return repoFixture() as never;
    });
    open();
    fireEvent.click(await screen.findByTestId('explore-generate'));
    expect(await screen.findByTestId('system-map-error')).toHaveTextContent('could not draw the map');
  });

  it('reports invalid scenes and server failures instead of silently showing the samples', async () => {
    api.mockResolvedValue({ id: 'system-map' } as never);
    open();
    expect(await screen.findByTestId('system-map-error')).toHaveTextContent('could not be generated');
    expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only');
  });

  it('goes back to the repository list when the repository is gone', async () => {
    api.mockImplementation(async (path) => {
      if (String(path) === '/repos/zz') throw new ApiError(404, 'repo_not_found');
      return null as never;
    });
    renderShell(<ExplorePage />, { route: '/repos/zz/explore', path: '/repos/:repoId/explore', prefs: prefsFixture() });
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/'));
  });
});
