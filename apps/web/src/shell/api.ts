export type ApiErrorExtra = { detail?: string; url?: string };

export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, public readonly extra: ApiErrorExtra = {}) {
    super(code);
  }
}

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
const NO_CONTENT = 204;

export const apiFetch = async <T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> => {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`/api${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  if (response.status === NO_CONTENT) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const body = (data as { error?: { code?: string; detail?: string; url?: string } } | null)?.error;
    throw new ApiError(response.status, body?.code ?? 'unknown', { ...(body?.detail ? { detail: body.detail } : {}), ...(body?.url ? { url: body.url } : {}) });
  }
  return data as T;
};
