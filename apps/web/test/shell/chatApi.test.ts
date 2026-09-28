import { ApiError, setCsrfToken } from '../../src/shell/api';
import { parseSse, streamChat, type ChatEvent } from '../../src/shell/chat/chatApi';

const streamOf = (chunks: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(new TextEncoder().encode(c));
      controller.close();
    },
  });

describe('parseSse', () => {
  it('parses complete messages and keeps the incomplete rest', () => {
    expect(parseSse('event: text\ndata: {"delta":"a"}\n\nevent: tool\ndata: {"x":1}\n\nevent: te')).toEqual({
      messages: [{ event: 'text', data: '{"delta":"a"}' }, { event: 'tool', data: '{"x":1}' }],
      rest: 'event: te',
    });
    expect(parseSse('event: done\r\ndata: {}\r\n\r\n')).toEqual({ messages: [{ event: 'done', data: '{}' }], rest: '' });
  });
});

describe('streamChat', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('posts with the CSRF token and dispatches events split across chunks', async () => {
    setCsrfToken('tok');
    const fetchMock = vi.fn().mockResolvedValue(new Response(streamOf(['event: text\ndata: {"delta":"Hel', 'lo"}\n\nevent: done\ndata: {"sceneIds":[],"usage":{"input":1,"output":2}}\n\n']), { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    vi.stubGlobal('fetch', fetchMock);
    const events: ChatEvent[] = [];
    await streamChat('o1', 'c1', { text: 'hi', language: 'es' }, (e) => events.push(e));
    expect(fetchMock).toHaveBeenCalledWith('/api/orgs/o1/conversations/c1/messages', expect.objectContaining({ method: 'POST', body: JSON.stringify({ text: 'hi', language: 'es' }) }));
    expect(fetchMock.mock.calls[0]![1].headers).toMatchObject({ 'x-csrf-token': 'tok', 'content-type': 'application/json' });
    expect(events).toEqual([{ type: 'text', delta: 'Hello' }, { type: 'done', sceneIds: [], usage: { input: 1, output: 2 } }]);
  });

  it('throws API errors for non-stream responses', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ error: { code: 'agent_not_configured' } }), { status: 409 })));
    await expect(streamChat('o1', 'c1', { text: 'hi' }, () => {})).rejects.toEqual(new ApiError(409, 'agent_not_configured'));
  });
});
