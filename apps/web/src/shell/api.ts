export class ApiError extends Error {
  constructor(public readonly status: number, public readonly code: string) {
    super(code);
  }
}

type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';
const NO_CONTENT = 204;

export const apiFetch = async <T>(path: string, init: { method?: Method; body?: unknown } = {}): Promise<T> => {
  const method = init.method ?? 'GET';
  const headers: Record<string, string> = {};
  if (init.body !== undefined) headers['content-type'] = 'application/json';
  const response = await fetch(`/api${path}`, { method, headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) });
  if (response.status === NO_CONTENT) return undefined as T;
  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const code = (data as { error?: { code?: string } } | null)?.error?.code ?? 'unknown';
    throw new ApiError(response.status, code);
  }
  return data as T;
};
