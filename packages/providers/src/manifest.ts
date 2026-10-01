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

/** GitHub refuses webhook URLs it cannot reach, so local servers get an App without webhook or events (use Re-index). */
export const buildAppManifest = ({ name, appUrl, publicApiUrl }: ManifestInput): Record<string, unknown> => {
  const reachable = !isLocalUrl(publicApiUrl);
  return {
    name,
    url: appUrl,
    ...(reachable ? { hook_attributes: { url: `${publicApiUrl}/api/github/webhook`, active: true } } : {}),
    redirect_url: `${appUrl}/api/github/manifest/callback`,
    setup_url: `${appUrl}/api/github/setup`,
    setup_on_update: true,
    request_oauth_on_install: true,
    callback_urls: [`${appUrl}/api/github/setup`],
    public: true,
    default_permissions: { contents: 'read', metadata: 'read', pull_requests: 'read' },
    ...(reachable ? { default_events: ['push'] } : {}),
  };
};

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

const OAUTH_TOKEN_URL = 'https://github.com/login/oauth/access_token';
const USER_PAGE_SIZE = 100;
const USER_MAX_PAGES = 10;

/** Exchanges the OAuth code GitHub sends after installation for a user-to-server token. */
export const exchangeUserCode = async (
  input: { clientId: string; clientSecret: string; code: string; redirectUri: string },
  fetchImpl: typeof fetch = fetch,
): Promise<string> => {
  const response = await fetchImpl(OAUTH_TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/json', 'user-agent': 'repository-designer' },
    body: JSON.stringify({ client_id: input.clientId, client_secret: input.clientSecret, code: input.code, redirect_uri: input.redirectUri }),
  });
  const body = (await response.json().catch(() => ({}))) as { access_token?: string; error?: string };
  if (!response.ok || !body.access_token) throw new Error(`GitHub OAuth: ${body.error ?? response.status}`);
  return body.access_token;
};

/** Installations of this App that the user behind the token can access. */
export const listUserInstallations = async (token: string, fetchImpl: typeof fetch = fetch, apiUrl = DEFAULT_API): Promise<{ id: number; accountLogin: string }[]> => {
  const installations: { id: number; accountLogin: string }[] = [];
  for (let page = 1; page <= USER_MAX_PAGES; page++) {
    const response = await fetchImpl(`${apiUrl}/user/installations?per_page=${USER_PAGE_SIZE}${page > 1 ? `&page=${page}` : ''}`, {
      headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repository-designer' },
    });
    const body = (await response.json().catch(() => ({}))) as { total_count?: number; installations?: { id: number; account?: { login?: string } }[]; message?: string };
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? 'request failed'}`);
    const batch = body.installations ?? [];
    installations.push(...batch.map((i) => ({ id: i.id, accountLogin: i.account?.login ?? '' })));
    if (batch.length < USER_PAGE_SIZE || installations.length >= (body.total_count ?? installations.length)) break;
  }
  return installations;
};
