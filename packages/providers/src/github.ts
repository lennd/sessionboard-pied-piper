import { createSign } from 'node:crypto';

export type GitHubAppConfig = { appId: string; privateKey: string; slug: string; apiUrl?: string };
export type GitHubRepo = { fullName: string; defaultBranch: string; private: boolean };
export type GitHubClient = {
  installationToken(installationId: number): Promise<string>;
  listInstallationRepos(installationId: number): Promise<GitHubRepo[]>;
  getInstallation(installationId: number): Promise<{ accountLogin: string }>;
  installUrl(state: string): string;
  listPullFiles(installationId: number, fullName: string, number: number): Promise<{ filename: string; status: string; patch?: string }[]>;
};

const JWT_BACKDATE_SECONDS = 60;
const JWT_LIFETIME_SECONDS = 540;
const DEFAULT_API = 'https://api.github.com';

const base64url = (value: string | Buffer) => Buffer.from(value).toString('base64url');

export const createAppJwt = (config: GitHubAppConfig, now: Date = new Date()): string => {
  const iat = Math.floor(now.getTime() / 1000) - JWT_BACKDATE_SECONDS;
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const payload = base64url(JSON.stringify({ iat, exp: iat + JWT_LIFETIME_SECONDS, iss: config.appId }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(config.privateKey).toString('base64url')}`;
};

export const githubCloneUrl = (fullName: string, token: string) => `https://x-access-token:${token}@github.com/${fullName}.git`;

export const createGitHubClient = (config: GitHubAppConfig, fetchImpl: typeof fetch = fetch): GitHubClient => {
  const api = config.apiUrl ?? DEFAULT_API;
  const request = async <T>(path: string, authorization: string, method = 'GET'): Promise<T> => {
    const response = await fetchImpl(`${api}${path}`, {
      method,
      headers: { authorization, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'repository-designer' },
    });
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${body.message ?? 'request failed'}`);
    return body as T;
  };
  const appAuth = () => `Bearer ${createAppJwt(config)}`;
  const installationToken = async (installationId: number) =>
    (await request<{ token: string }>(`/app/installations/${installationId}/access_tokens`, appAuth(), 'POST')).token;

  return {
    installationToken,
    async listInstallationRepos(installationId) {
      const token = await installationToken(installationId);
      const body = await request<{ repositories: { full_name: string; default_branch: string; private: boolean }[] }>('/installation/repositories?per_page=100', `token ${token}`);
      return body.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private }));
    },
    async getInstallation(installationId) {
      const body = await request<{ account: { login: string } }>(`/app/installations/${installationId}`, appAuth());
      return { accountLogin: body.account.login };
    },
    async listPullFiles(installationId, fullName, number) {
      const token = await installationToken(installationId);
      const files = await request<{ filename: string; status: string; patch?: string }[]>(`/repos/${fullName}/pulls/${number}/files?per_page=100`, `token ${token}`);
      return files.map((f) => ({ filename: f.filename, status: f.status, ...(f.patch === undefined ? {} : { patch: f.patch }) }));
    },
    installUrl: (state) => `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`,
  };
};
