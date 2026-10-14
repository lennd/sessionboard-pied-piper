import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { PullsPanel } from '../../src/shell/pulls/PullsPanel';
import { renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
const scene = sampleRegistry['iot-telemetry']!;
const pull = { number: 7, title: 'Store rewrite', author: 'ana', draft: false, headRef: 'feature/store', baseRef: 'main', updatedAt: '2026-10-13T10:00:00Z', url: 'https://github.com/acme/x/pull/7', additions: 3, deletions: 2, changedFiles: 2 };
const branch = { branch: 'feature/x', base: 'main', ahead: 2, touched: [{ path: 'src/a.ts', change: 'modified' as const }] };
const impact = (id: string) => ({ ...scene, id });

const mockApi = (options: { available?: boolean; reason?: string; branch?: typeof branch | null; map?: boolean } = {}) =>
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.includes('/pulls?refresh=1') || p.endsWith('/pulls')) return { available: options.available ?? true, reason: options.reason, pulls: options.available === false ? [] : [pull], branch: options.branch === undefined ? branch : options.branch } as never;
    if (p.endsWith('/pulls/7')) return { pull: { ...pull, body: 'Rewrites the **store**.' }, files: [{ path: 'src/a.ts', additions: 2, deletions: 1, change: 'modified' }, { path: 'src/new.ts', additions: 1, deletions: 0, change: 'added' }] } as never;
    if (p.endsWith('/impact')) {
      if (options.map === false) throw new ApiError(404, 'no_system_map');
      return impact(p.includes('/branch/') ? 'impact-branch' : 'impact-pr-7') as never;
    }
    if (p.endsWith('/impact/explain') && init?.method === 'POST') return { scene: impact('impact-pr-7-explained'), text: 'The **store** is rewritten.' } as never;
    throw new Error(`unexpected ${p}`);
  });

const render = () => {
  const openScene = vi.fn();
  renderShell(<PullsPanel repoId="r1" ctx={{ openScene, selectNode: vi.fn(), selected: null, scene }} />);
  return { openScene };
};
beforeEach(() => {
  api.mockReset();
  delete window.rdi;
});

describe('PullsPanel', () => {
  it('lists the current branch and the open pull requests', async () => {
    mockApi();
    render();
    expect(await screen.findByTestId('pull-7')).toHaveTextContent('#7 Store rewrite');
    expect(screen.getByTestId('pull-7')).toHaveTextContent('feature/store → main · ana');
    expect(screen.getByTestId('pull-branch')).toHaveTextContent('Current branch vs main');
    expect(screen.getByTestId('pull-branch')).toHaveTextContent('2 commits ahead · 1 files');
    fireEvent.click(screen.getByTestId('pulls-refresh'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/pulls?refresh=1'));
  });

  it('opens a pull request: files with status, impact overlay, explanation and GitHub link', async () => {
    mockApi();
    const { openScene } = render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    expect(await screen.findByTestId('pull-detail')).toHaveTextContent('#7 Store rewrite');
    expect(screen.getByTestId('pull-file-src/new.ts')).toHaveTextContent('+ added');
    expect(screen.getByTestId('pull-file-src/a.ts')).toHaveTextContent('+2 −1');
    await waitFor(() => expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-pr-7' }), 'changes'));
    fireEvent.click(screen.getByTestId('pull-explain'));
    expect(await screen.findByTestId('pull-explanation')).toHaveTextContent('store is rewritten');
    expect(api).toHaveBeenCalledWith('/repos/r1/impact/explain', { method: 'POST', body: { pull: 7 } });
    expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-pr-7-explained' }), 'changes');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('pull-github'));
    expect(open).toHaveBeenCalledWith(pull.url, '_blank', 'noopener,noreferrer');
    window.rdi = { pickFolder: vi.fn(), openExternal: vi.fn() };
    fireEvent.click(screen.getByTestId('pull-github'));
    expect(window.rdi.openExternal).toHaveBeenCalledWith(pull.url);
    fireEvent.click(screen.getByTestId('pull-back'));
    expect(screen.getByTestId('pulls-panel')).toBeInTheDocument();
  });

  it('opens the current branch comparison and asks to draw the map when there is none', async () => {
    mockApi({ map: false });
    const { openScene } = render();
    fireEvent.click(await screen.findByTestId('pull-branch'));
    expect(await screen.findByTestId('pull-no-map')).toHaveTextContent('Draw the system map first');
    expect(screen.getByTestId('pull-file-src/a.ts')).toBeInTheDocument();
    expect(openScene).not.toHaveBeenCalled();
    expect(api).toHaveBeenCalledWith('/repos/r1/branch/impact');
  });

  it('explains why pull requests are unavailable', async () => {
    mockApi({ available: false, reason: 'gh_not_logged_in', branch: null });
    render();
    expect(await screen.findByTestId('pulls-unavailable')).toHaveTextContent('gh auth login');
    expect(screen.getByTestId('pull-no-branch')).toBeInTheDocument();
  });
});
