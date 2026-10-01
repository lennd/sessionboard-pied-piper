const DEFAULT_API = 'https://api.github.com';
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '0.0.0.0', '::1', '[::1]']);

export type ManifestInput = { name: string; appUrl: string; publicApiUrl: string };
export type ManifestOwner = { type: 'user' } | { type: 'org'; login: string };
export type ManifestApp = { appId: string; slug: string; name: string; htmlUrl: string; ownerLogin: string; privateKey: string; webhookSecret: string; clientId: string; clientSecret: string };

export const isLocalUrl = (url: string): boolean => {
  try {
    return LOCAL_HOSTS.has(new URL(url).hostname);
  } catch {
    return false;
  }
};

export const buildAppManifest = ({ name, appUrl, publicApiUrl }: ManifestInput): Record<string, unknown> => ({
  name,
  url: appUrl,
  hook_attributes: { url: `${publicApiUrl}/api/github/webhook`, active: !isLocalUrl(publicApiUrl) },
  redirect_url: `${appUrl}/api/github/manifest/callback`,
  setup_url: `${appUrl}/api/github/setup`,
  setup_on_update: true,
  public: true,
  default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
  default_events: ['push'],
});

export const manifestPostUrl = (owner: ManifestOwner, state: string): string =>
  `${owner.type === 'org' ? `https://github.com/organizations/${encodeURIComponent(owner.login)}` : 'https://github.com'}/settings/apps/new?state=${encodeURIComponent(state)}`;

export const exchangeManifestCode = async (code: string, fetchImpl: typeof fetch = fetch, apiUrl = DEFAULT_API): Promise<ManifestApp> => {
  const response = await fetchImpl(`${apiUrl}/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: { accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repository-designer' },
  });
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown> & { message?: string; owner?: { login?: string } };
  if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? 'request failed'}`);
  return {
    appId: String(body.id), slug: String(body.slug), name: String(body.name), htmlUrl: String(body.html_url), ownerLogin: String(body.owner?.login ?? ''),
    privateKey: String(body.pem), webhookSecret: String(body.webhook_secret), clientId: String(body.client_id), clientSecret: String(body.client_secret),
  };
};
