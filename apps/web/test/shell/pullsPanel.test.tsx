import { fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { ApiError, apiFetch } from '../../src/shell/api';
import { PullsPanel } from '../../src/shell/pulls/PullsPanel';
import { renderShell } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/chat/chatApi', async (original) => ({ ...(await original<typeof import('../../src/shell/chat/chatApi')>()), explainToScene: vi.fn(), streamChat: vi.fn() }));
import { explainToScene, streamChat } from '../../src/shell/chat/chatApi';
const explainMock = vi.mocked(explainToScene);
const streamMock = vi.mocked(streamChat);
const api = vi.mocked(apiFetch);
const scene = sampleRegistry['iot-telemetry']!;
const pending = { decision: 'pending' as const, approvedByMe: false, approvals: 0, changesRequested: 0 };
const pull = { number: 7, title: 'Store rewrite', author: 'ana', draft: false, headRef: 'feature/store', baseRef: 'main', updatedAt: '2026-10-13T10:00:00Z', url: 'https://github.com/acme/x/pull/7', additions: 3, deletions: 2, changedFiles: 2, review: pending };
const approvedPull = { ...pull, number: 8, title: 'Already approved', review: { decision: 'approved' as const, approvedByMe: true, approvals: 1, changesRequested: 0 } };
const dismissedPull = { ...pull, number: 9, title: 'Set aside', triage: { state: 'dismissed' as const, at: '2026-10-13T10:00:00Z', note: null } };
const branch = { branch: 'feature/x', base: 'main', ahead: 2, touched: [{ path: 'src/a.ts', change: 'modified' as const }] };
const impact = (id: string) => ({ ...scene, id, risks: [{ id: 'r1', title: 'Breaks callers', category: 'reliability' as const, severity: 'high' as const, explanation: 'The handler changed.', mitigation: 'Run the suite.', nodeIds: [scene.nodes[0]!.id] }, { id: 'r2', title: 'Unclear', category: 'complexity' as const, severity: 'low' as const, explanation: 'No code.', nodeIds: [scene.nodes[1]!.id] }] });

const mockApi = (options: { available?: boolean; reason?: string; branch?: typeof branch | null; map?: boolean; reviewError?: ApiError; cached?: boolean } = {}) => {
  explainMock.mockReset();
  explainMock.mockResolvedValue({ id: 'sc-explained', scene: impact('impact-pr-7-explained'), text: 'The **store** is rewritten.' });
  return api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.includes('/pulls?refresh=1') || p.endsWith('/pulls')) return { available: options.available ?? true, reason: options.reason, pulls: options.available === false ? [] : [pull, approvedPull, dismissedPull], branch: options.branch === undefined ? branch : options.branch } as never;
    if (p.endsWith('/pulls/7')) return { pull: { ...pull, body: 'Rewrites the **store**.' }, files: [{ path: 'src/a.ts', additions: 2, deletions: 1, change: 'modified' }, { path: 'src/new.ts', additions: 1, deletions: 0, change: 'added' }], explanation: options.cached ? { sceneId: 'sc-cached', text: 'Cached: the **store** moved.', at: '2026-10-14T10:00:00Z', scene: impact('impact-pr-7-cached') } : null } as never;
    if (p.includes('/explanations/')) throw new ApiError(404, 'not_found');
    if (p.endsWith('/impact')) {
      if (options.map === false) throw new ApiError(404, 'no_system_map');
      return impact(p.includes('/branch/') ? 'impact-branch' : 'impact-pr-7') as never;
    }
    void init;
    if (p.endsWith('/pulls/7/risks') && init?.method === 'POST') return { risks: [{ id: 'r1', title: 'Breaks callers', severity: 'high', category: 'reliability', pieces: ['API'], anchor: { path: 'src/a.ts', startLine: 12, line: 18 } }, { id: 'r2', title: 'Unclear', severity: 'low', category: 'complexity', pieces: [], anchor: null }] } as never;
    if (p.endsWith('/pulls/7/review') && init?.method === 'POST') {
      if (options.reviewError) throw options.reviewError;
      return { id: 55, url: 'https://github.com/acme/x/pull/7#pullrequestreview-55', inline: 1, summary: 0 } as never;
    }
    if (p.endsWith('/pulls/7/decision') && init?.method === 'POST') return { id: 9, url: 'https://github.com/acme/x/pull/7#pullrequestreview-9', decision: (init.body as { decision: string }).decision } as never;
    if (p.endsWith('/agent')) return { enabled: true, model: 'm', usage: { input: 0, output: 0, costUsd: 0 } } as never;
    if (p.endsWith('/conversations') && init?.method === 'POST') return { id: 'c9', title: (init.body as { title?: string }).title ?? 'New conversation', updatedAt: '2026-10-13T10:00:00Z' } as never;
    if (p.endsWith('/conversations')) return [{ id: 'c1', title: 'General question', updatedAt: '2026-10-13T10:00:00Z' }] as never;
    if (p.endsWith('/conversations/c9')) return { id: 'c9', title: '#7 · Store rewrite', items: [], scenes: [] } as never;
    if (p.endsWith('/pulls/7/triage')) return (init?.method === 'DELETE' ? undefined : { number: 7, triage: { state: (init?.body as { state: string }).state, at: '2026-10-13T10:00:00Z', note: null } }) as never;
    throw new Error(`unexpected ${p}`);
  });
};

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
    expect(screen.getByTestId('pulls-group-pending')).toHaveTextContent('#7 Store rewrite');
    expect(screen.getByTestId('pulls-group-approved')).toHaveTextContent('#8 Already approved');
    expect(screen.getByTestId('pull-8').querySelector('[data-testid="review-tag-mine"]')).toHaveTextContent('approved by you');
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
    expect(await screen.findByTestId('pull-verdict')).toHaveTextContent('Does not pass yet');
    expect(screen.getByTestId('verdict-action-r1')).toHaveTextContent('Run the suite.');
    await waitFor(() => expect(screen.getByTestId('verdict-action-r1')).toHaveTextContent('src/a.ts:12-18'));
    expect(explainMock).toHaveBeenCalledWith('/repos/r1', { pull: 7 }, expect.any(Function));
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

  it('previews the risks anchored to the diff and posts the selected ones as a review', async () => {
    mockApi();
    render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    expect(await screen.findByTestId('pull-risk-r1')).toHaveTextContent('high');
    expect(screen.getByTestId('pull-risk-r1')).toHaveTextContent('reliability');
    expect(screen.getByTestId('pull-risk-anchor-r1')).toHaveTextContent('src/a.ts:12-18');
    expect(screen.getByTestId('pull-risk-r1')).toHaveTextContent('API');
    expect(screen.getByTestId('pull-risk-anchor-r2')).toHaveTextContent('summary');
    expect(api).toHaveBeenCalledWith('/repos/r1/pulls/7/risks', { method: 'POST', body: { scene: expect.objectContaining({ id: 'impact-pr-7' }) } });
    fireEvent.click(screen.getByTestId('pull-risk-check-r2'));
    fireEvent.click(screen.getByTestId('pull-comment'));
    expect(await screen.findByTestId('pull-review-posted')).toHaveTextContent('1 inline, 0 in the summary');
    expect(api).toHaveBeenCalledWith('/repos/r1/pulls/7/review', { method: 'POST', body: { scene: expect.objectContaining({ id: 'impact-pr-7' }), riskIds: ['r1'] } });
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('pull-review-open'));
    expect(open).toHaveBeenCalledWith('https://github.com/acme/x/pull/7#pullrequestreview-55', '_blank', 'noopener,noreferrer');
  });

  it('explains a review blocked by a pending review in GitHub and links to it', async () => {
    mockApi({ reviewError: new ApiError(409, 'pending_review', { detail: 'User can only have one pending review per pull request', url: 'https://github.com/acme/x/pull/7#pullrequestreview-12' }) });
    render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    await screen.findByTestId('pull-risk-r1');
    fireEvent.click(screen.getByTestId('pull-comment'));
    expect(await screen.findByRole('alert')).toHaveTextContent('You already have an unsubmitted review on this pull request in GitHub.');
    const open = vi.spyOn(window, 'open').mockImplementation(() => null);
    fireEvent.click(screen.getByTestId('pull-error-open'));
    expect(open).toHaveBeenCalledWith('https://github.com/acme/x/pull/7#pullrequestreview-12', '_blank', 'noopener,noreferrer');
  });

  it('shows the reason GitHub gave when gh fails for no known cause', async () => {
    mockApi({ reviewError: new ApiError(502, 'gh_failed', { detail: 'Validation Failed' }) });
    render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    await screen.findByTestId('pull-risk-r1');
    fireEvent.click(screen.getByTestId('pull-comment'));
    expect(await screen.findByRole('alert')).toHaveTextContent('GitHub could not be reached. Validation Failed');
    expect(screen.queryByTestId('pull-error-open')).toBeNull();
  });

  it('embeds a chat about the opened pull request with its own conversations', async () => {
    mockApi();
    streamMock.mockResolvedValue(undefined);
    render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    const chat = await screen.findByTestId('pull-chat');
    expect(chat.querySelector('[data-testid="chat-panel"]')).not.toBeNull();
    expect(screen.getByTestId('chat-about-pull')).toHaveTextContent('Chat about pull request #7');
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/conversations'));
    expect(screen.getByTestId('chat-conversations')).not.toHaveTextContent('General question');
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'What does it change?' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/conversations', { method: 'POST', body: { title: '#7 · Store rewrite' } }));
    await waitFor(() => expect(streamMock).toHaveBeenCalled());
    expect(streamMock.mock.calls[0]![2]).toMatchObject({ text: 'What does it change?', pull: 7 });
  });

  it('reuses the stored explanation of a pull request instead of asking Claude again', async () => {
    mockApi({ cached: true });
    const { openScene } = render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    expect(await screen.findByTestId('pull-explanation')).toHaveTextContent('Cached: the store moved.');
    expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ id: 'impact-pr-7-cached' }), 'changes');
    expect(explainMock).not.toHaveBeenCalled();
    expect(screen.getByTestId('pull-explain')).toHaveTextContent('Explain again');
    expect(screen.getByTestId('pull-explained-at')).toHaveTextContent('Explained');
    await screen.findByTestId('pull-risk-r1');
  });

  it('marks a pull request as reviewed or dismissed and keeps dismissed ones apart', async () => {
    mockApi();
    render();
    expect(await screen.findByTestId('pulls-group-dismissed')).toHaveTextContent('#9 Set aside');
    expect(screen.getByTestId('triage-tag-9')).toHaveTextContent('dismissed');
    fireEvent.click(screen.getByTestId('pull-7'));
    fireEvent.click(await screen.findByTestId('pull-triage-reviewed'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/repos/r1/pulls/7/triage', { method: 'PUT', body: { state: 'reviewed' } }));
  });

  it('shows a coloured chip per review state and lets the user request changes with a note', async () => {
    mockApi();
    render();
    expect((await screen.findByTestId('pull-7')).querySelector('[data-testid="review-tag-pending"]')).toHaveTextContent('pending review');
    expect(screen.getByTestId('pull-8').querySelector('.review-chip.is-approved')).not.toBeNull();
    fireEvent.click(screen.getByTestId('pull-7'));
    fireEvent.click(await screen.findByTestId('pull-request-changes'));
    expect(screen.getByTestId('pull-approve-confirm')).toBeDisabled();
    fireEvent.change(screen.getByTestId('pull-approve-note'), { target: { value: 'Please add tests' } });
    fireEvent.click(screen.getByTestId('pull-approve-confirm'));
    expect(await screen.findByTestId('pull-changes-requested')).toHaveTextContent('Changes requested');
    expect(api).toHaveBeenCalledWith('/repos/r1/pulls/7/decision', { method: 'POST', body: { decision: 'request_changes', note: 'Please add tests' } });
    expect(screen.getByTestId('pull-detail').querySelector('[data-testid="review-tag-changes-mine"]')).toHaveTextContent('changes requested by you');
  });

  it('approves the pull request from the app with an optional note', async () => {
    mockApi();
    render();
    fireEvent.click(await screen.findByTestId('pull-7'));
    fireEvent.click(await screen.findByTestId('pull-approve'));
    fireEvent.change(screen.getByTestId('pull-approve-note'), { target: { value: 'Ship it' } });
    fireEvent.click(screen.getByTestId('pull-approve-confirm'));
    expect(await screen.findByTestId('pull-approved')).toHaveTextContent('approved');
    expect(api).toHaveBeenCalledWith('/repos/r1/pulls/7/decision', { method: 'POST', body: { decision: 'approve', note: 'Ship it' } });
    expect(screen.queryByTestId('pull-approve')).not.toBeInTheDocument();
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
