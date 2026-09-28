import { screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { ExplorePage } from '../../src/shell/pages/ExplorePage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/workspace/Workspace', () => ({
  Workspace: ({ extraScenes }: { extraScenes?: { id: string }[] }) => <div data-testid="workspace">{(extraScenes ?? []).map((s) => s.id).join(',') || 'samples-only'}</div>,
}));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

describe('ExplorePage', () => {
  it('passes the generated system map to the workspace', async () => {
    api.mockResolvedValue({ ...sampleRegistry['iot-telemetry']!, id: 'system-map', title: 'System map' } as never);
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('system-map'));
    expect(api).toHaveBeenCalledWith('/orgs/o1/system-map');
  });

  it('falls back to the samples when there is no map yet', async () => {
    api.mockImplementation(async (path) => {
      if (String(path).endsWith('/system-map')) throw new ApiError(404, 'not_found');
      return sessionFixture() as never;
    });
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    await waitFor(() => expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only'));
  });

  it('reports invalid scenes and server failures instead of silently showing the samples', async () => {
    api.mockImplementation(async (path) => (String(path).endsWith('/system-map') ? { id: 'system-map' } : sessionFixture()) as never);
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    expect(await screen.findByTestId('system-map-error')).toHaveTextContent('could not be generated');
    expect(screen.getByTestId('workspace')).toHaveTextContent('samples-only');
  });

  it('reports server errors while generating the map', async () => {
    api.mockImplementation(async (path) => {
      if (String(path).endsWith('/system-map')) throw new ApiError(500, 'internal');
      return sessionFixture() as never;
    });
    renderShell(<ExplorePage />, { route: '/orgs/o1/explore', path: '/orgs/:orgId/explore', session: sessionFixture() });
    expect(await screen.findByTestId('system-map-error')).toBeInTheDocument();
  });
});
