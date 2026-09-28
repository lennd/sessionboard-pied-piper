import { ApiError, apiFetch, setCsrfToken } from '../../src/shell/api';

const respond = (status: number, body: unknown) =>
  vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

afterEach(() => { vi.restoreAllMocks(); setCsrfToken(null); });

describe('apiFetch', () => {
  it('prefixes /api, sends JSON and the csrf header on mutations', async () => {
    const spy = respond(200, { ok: true });
    setCsrfToken('csrf-1');
    await apiFetch('/me', { method: 'PATCH', body: { theme: 'paper' } });
    const [url, init] = spy.mock.calls[0]!;
    expect(url).toBe('/api/me');
    expect(init).toMatchObject({ method: 'PATCH', credentials: 'same-origin', body: '{"theme":"paper"}' });
    expect((init!.headers as Record<string, string>)['x-csrf-token']).toBe('csrf-1');
    expect((init!.headers as Record<string, string>)['content-type']).toBe('application/json');
  });

  it('does not send the csrf header on GET', async () => {
    const spy = respond(200, []);
    setCsrfToken('csrf-1');
    await apiFetch('/orgs');
    expect((spy.mock.calls[0]![1]!.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
  });

  it('throws ApiError with the server code', async () => {
    respond(401, { error: { code: 'invalid_credentials' } });
    await expect(apiFetch('/auth/login', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 401, code: 'invalid_credentials' });
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
