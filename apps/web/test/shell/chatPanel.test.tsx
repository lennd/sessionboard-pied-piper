import { act, fireEvent, screen, waitFor } from '@testing-library/react';
import { sampleRegistry } from '@rdi/scene';
import { apiFetch } from '../../src/shell/api';
import { ChatPanel } from '../../src/shell/chat/ChatPanel';
import { streamChat, type ChatEvent } from '../../src/shell/chat/chatApi';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
vi.mock('../../src/shell/chat/chatApi', async (original) => ({ ...(await original<typeof import('../../src/shell/chat/chatApi')>()), streamChat: vi.fn() }));
const api = vi.mocked(apiFetch);
const stream = vi.mocked(streamChat);
const scene = sampleRegistry['iot-telemetry']!;

const mockApi = (enabled = true, conversation: object = { id: 'c1', title: 'New conversation', items: [], scenes: [] }, list: object[] = [], createdId = 'c1') =>
  api.mockImplementation(async (path, init) => {
    const p = String(path);
    if (p.endsWith('/agent')) return { enabled, model: 'm', tokensUsed: 0, tokenBudget: 10 } as never;
    if (p.endsWith('/conversations') && init?.method === 'POST') return { id: createdId, title: 'New conversation', updatedAt: '2026-09-28T10:00:00Z' } as never;
    if (p.endsWith('/conversations')) return list as never;
    if (p.includes('/translate')) return { id: 'sc2', scene: { ...scene, language: 'es' } } as never;
    if (p.includes('/conversations/c1')) return conversation as never;
    if (p.includes('/conversations/c2')) return { id: 'c2', title: 'second', items: [{ role: 'user', text: 'second question', turn: 1 }], scenes: [] } as never;
    return sessionFixture() as never;
  });

const render = (selected: { label: string; graphRef: string } | null = null) => {
  const openScene = vi.fn();
  renderShell(<ChatPanel orgId="o1" language="es" ctx={{ openScene, selectNode: vi.fn(), selected, scene }} />, { session: sessionFixture() });
  return { openScene };
};

beforeEach(() => {
  api.mockReset();
  stream.mockReset();
});

describe('ChatPanel', () => {
  it('shows a notice when the agent is not configured', async () => {
    mockApi(false);
    render();
    expect(await screen.findByTestId('chat-disabled')).toBeInTheDocument();
    expect(screen.getByTestId('chat-send')).toBeDisabled();
  });

  it('creates a conversation, streams the answer and opens the scene', async () => {
    mockApi();
    stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'tool', name: 'search_graph', status: 'running', summary: 'search_graph' });
      onEvent({ type: 'scene', id: 'sc1', scene });
      onEvent({ type: 'text', delta: 'Readings ' });
      onEvent({ type: 'text', delta: 'flow to the broker.' });
      onEvent({ type: 'done', sceneIds: ['sc1'], usage: { input: 1, output: 1 } });
    });
    const { openScene } = render();
    await screen.findByTestId('chat-input');
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'How do readings flow?' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('o1', 'c1', { text: 'How do readings flow?', language: 'es', focus: null }, expect.any(Function), expect.any(AbortSignal)));
    expect(await screen.findByText('Readings flow to the broker.')).toBeInTheDocument();
    expect(screen.getByTestId('chat-message-0')).toHaveTextContent('How do readings flow?');
    expect(screen.getByTestId('chat-scene-sc1')).toHaveTextContent('IoT telemetry ingestion');
    expect(openScene).toHaveBeenCalledWith(scene);
  });

  it('attaches the selected piece and regenerates a scene in another language', async () => {
    mockApi(true, { id: 'c1', title: 'x', items: [{ role: 'user', text: 'q', turn: 1 }, { role: 'assistant', text: 'a', turn: 1 }], scenes: [{ id: 'sc1', turn: 1, scene }] }, [{ id: 'c1', title: 'x', updatedAt: '2026-09-28T10:00:00Z' }]);
    stream.mockResolvedValue(undefined);
    const { openScene } = render({ label: 'MQTT broker', graphRef: 'svc:broker' });
    fireEvent.click(await screen.findByTestId('chat-ask-about'));
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'Why?' } });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('o1', 'c1', { text: 'Why?', language: 'es', focus: { label: 'MQTT broker', graphRef: 'svc:broker' } }, expect.any(Function), expect.any(AbortSignal)));
    fireEvent.click(await screen.findByTestId('chat-translate-sc1'));
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/scenes/sc1/translate', { method: 'POST', body: { language: 'es' } }));
    await waitFor(() => expect(openScene).toHaveBeenCalledWith(expect.objectContaining({ language: 'es' })));
  });

  it('shows stream errors', async () => {
    mockApi();
    stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
      onEvent({ type: 'error', code: 'token_budget_exceeded', message: 'x' });
    });
    render();
    fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: 'hi' } });
    fireEvent.click(screen.getByTestId('chat-send'));
    expect(await screen.findByTestId('chat-error')).toHaveTextContent('agent budget');
  });

  it('survives browsers whose scrollIntoView returns a promise', async () => {
    const original = Element.prototype.scrollIntoView;
    Element.prototype.scrollIntoView = (() => Promise.resolve()) as unknown as typeof original;
    try {
      mockApi();
      stream.mockImplementation(async (_o, _c, _b, onEvent: (e: ChatEvent) => void) => {
        onEvent({ type: 'text', delta: 'one' });
        onEvent({ type: 'text', delta: ' two' });
      });
      const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
      const view = renderShell(<ChatPanel orgId="o1" language="es" ctx={{ openScene: vi.fn(), selectNode: vi.fn(), selected: null, scene }} />, { session: sessionFixture() });
      fireEvent.change(await screen.findByTestId('chat-input'), { target: { value: 'hi' } });
      await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
      fireEvent.click(screen.getByTestId('chat-send'));
      expect(await screen.findByText('one two')).toBeInTheDocument();
      view.unmount();
      expect(errors.mock.calls.flat().join(' ')).not.toMatch(/destroy|must not return anything/);
      errors.mockRestore();
    } finally {
      Element.prototype.scrollIntoView = original;
    }
  });

  it('starts a genuinely new conversation even when older ones exist', async () => {
    mockApi(true, { id: 'c1', title: 'old', items: [{ role: 'user', text: 'old question', turn: 1 }], scenes: [] }, [{ id: 'c1', title: 'old', updatedAt: '2026-09-28T10:00:00Z' }], 'c2');
    stream.mockResolvedValue(undefined);
    render();
    expect(await screen.findByText('old question')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('chat-new'));
    await waitFor(() => expect(screen.queryByText('old question')).toBeNull());
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'fresh start' } });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalledWith('o1', 'c2', expect.objectContaining({ text: 'fresh start' }), expect.any(Function), expect.any(AbortSignal)));
    expect(screen.queryByText('old question')).toBeNull();
  });

  it('locks conversation switching while an answer streams and reloads a created conversation later', async () => {
    mockApi(true, { id: 'c1', title: 'old', items: [], scenes: [] }, [{ id: 'c1', title: 'old', updatedAt: '2026-09-28T10:00:00Z' }, { id: 'c2', title: 'second', updatedAt: '2026-09-28T09:00:00Z' }], 'c2');
    let finish: () => void = () => {};
    stream.mockImplementation(() => new Promise<void>((resolve) => { finish = resolve; }));
    render();
    await screen.findByTestId('chat-input');
    fireEvent.click(screen.getByTestId('chat-new'));
    fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'q' } });
    await waitFor(() => expect(screen.getByTestId('chat-send')).toBeEnabled());
    fireEvent.click(screen.getByTestId('chat-send'));
    await waitFor(() => expect(stream).toHaveBeenCalled());
    expect(screen.getByTestId('chat-conversations')).toBeDisabled();
    expect(screen.getByTestId('chat-new')).toBeDisabled();
    await act(async () => finish());
    await waitFor(() => expect(screen.getByTestId('chat-conversations')).toBeEnabled());
    fireEvent.change(screen.getByTestId('chat-conversations'), { target: { value: 'c1' } });
    fireEvent.change(screen.getByTestId('chat-conversations'), { target: { value: 'c2' } });
    await waitFor(() => expect(api).toHaveBeenCalledWith('/orgs/o1/conversations/c2'));
    expect(await screen.findByText('second question')).toBeInTheDocument();
  });
});

