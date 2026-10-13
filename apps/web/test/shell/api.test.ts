import { ApiError, apiFetch } from '../../src/shell/api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => vi.restoreAllMocks());

describe('apiFetch', () => {
  it('prefixes /api and sends JSON bodies', async () => {
    const spy = respond(200, { ok: true });
    await apiFetch('/prefs', { method: 'PATCH', body: { theme: 'paper' } });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/prefs');
    expect(init).toMatchObject({ method: 'PATCH', body: '{"theme":"paper"}' });
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('throws ApiError with the server code', async () => {
    respond(404, { error: { code: 'repo_not_found' } });
    await expect(apiFetch('/repos/x')).rejects.toMatchObject({ status: 404, code: 'repo_not_found' });
  });

  it('handles 204 and non-JSON errors', async () => {
    respond(204, null);
    expect(await apiFetch('/x', { method: 'DELETE' })).toBeUndefined();
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('boom', { status: 502 }));
    const error = await apiFetch('/x').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({ status: 502, code: 'unknown' });
  });
});
