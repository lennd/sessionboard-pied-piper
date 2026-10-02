import { createSign } from 'node:crypto';

export type GitHubAppConfig = { appId: string; privateKey: string; slug: string; apiUrl?: string };
export type GitHubRepo = { fullName: string; defaultBranch: string; private: boolean };
export type GitHubClient = {
  installationToken(installationId: number): Promise<string>;
  listInstallationRepos(installationId: number): Promise<GitHubRepo[]>;
  getInstallation(installationId: number): Promise<{ accountLogin: string }>;
  installUrl(state: string): string;
  listPullFiles(installationId: number, fullName: string, number: number): Promise<PullFile[]>;
  listOpenPulls(installationId: number, fullName: string): Promise<PullSummary[]>;
  getPull(installationId: number, fullName: string, number: number): Promise<PullDetail>;
};

export type PullFile = { filename: string; status: string; additions: number; deletions: number; patch?: string; previousFilename?: string };
export type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string };
export type PullDetail = PullSummary & { body: string; additions: number; deletions: number; changedFiles: number };

type RawPull = { number: number; title: string; user?: { login?: string } | null; draft?: boolean; head: { ref: string }; base: { ref: string }; updated_at: string; html_url: string };
type RawPullDetail = RawPull & { body?: string | null; additions?: number; deletions?: number; changed_files?: number };
type RawPullFile = { filename: string; status: string; additions?: number; deletions?: number; patch?: string; previous_filename?: string };

const toPullSummary = (p: RawPull): PullSummary => ({
  number: p.number, title: p.title, author: p.user?.login ?? 'unknown', draft: Boolean(p.draft), headRef: p.head.ref, baseRef: p.base.ref, updatedAt: p.updated_at, url: p.html_url,
});

const JWT_BACKDATE_SECONDS = 60;
const PAGE_SIZE = 100;
const TOKEN_REFRESH_MARGIN_MS = 5 * 60_000;
const DEFAULT_TOKEN_LIFETIME_MS = 50 * 60_000;
const MAX_PAGES = 10;
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
  /** Follows page numbers for list endpoints that return a bare array. */
  const paged = async <T>(path: string, authorization: string): Promise<T[]> => {
    const items: T[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const batch = await request<T[]>(page > 1 ? `${path}&page=${page}` : path, authorization);
      items.push(...batch);
      if (batch.length < PAGE_SIZE) break;
    }
    return items;
  };
  const appAuth = () => `Bearer ${createAppJwt(config)}`;
  const tokens = new Map<number, { token: string; expiresAt: number }>();
  /** Installation tokens live about an hour; reuse them until five minutes before they expire. */
  const installationToken = async (installationId: number) => {
    const cached = tokens.get(installationId);
    if (cached && cached.expiresAt - TOKEN_REFRESH_MARGIN_MS > Date.now()) return cached.token;
    const body = await request<{ token: string; expires_at?: string }>(`/app/installations/${installationId}/access_tokens`, appAuth(), 'POST');
    const expiresAt = body.expires_at ? Date.parse(body.expires_at) : Date.now() + DEFAULT_TOKEN_LIFETIME_MS;
    tokens.set(installationId, { token: body.token, expiresAt });
    return body.token;
  };

  return {
    installationToken,
    async listInstallationRepos(installationId) {
      const token = await installationToken(installationId);
      const repos: GitHubRepo[] = [];
      for (let page = 1; page <= MAX_PAGES; page++) {
        const body = await request<{ total_count?: number; repositories: { full_name: string; default_branch: string; private: boolean }[] }>(
          `/installation/repositories?per_page=${PAGE_SIZE}${page > 1 ? `&page=${page}` : ''}`, `token ${token}`,
        );
        repos.push(...body.repositories.map((r) => ({ fullName: r.full_name, defaultBranch: r.default_branch, private: r.private })));
        if (body.repositories.length < PAGE_SIZE || repos.length >= (body.total_count ?? repos.length)) break;
      }
      return repos;
    },
    async getInstallation(installationId) {
      const body = await request<{ account: { login: string } }>(`/app/installations/${installationId}`, appAuth());
      return { accountLogin: body.account.login };
    },
    async listPullFiles(installationId, fullName, number) {
      const token = await installationToken(installationId);
      const files = await paged<RawPullFile>(`/repos/${fullName}/pulls/${number}/files?per_page=${PAGE_SIZE}`, `token ${token}`);
      return files.map((f) => ({
        filename: f.filename, status: f.status, additions: f.additions ?? 0, deletions: f.deletions ?? 0,
        ...(f.patch === undefined ? {} : { patch: f.patch }), ...(f.previous_filename ? { previousFilename: f.previous_filename } : {}),
      }));
    },
    async listOpenPulls(installationId, fullName) {
      const token = await installationToken(installationId);
      return (await paged<RawPull>(`/repos/${fullName}/pulls?state=open&per_page=${PAGE_SIZE}`, `token ${token}`)).map(toPullSummary);
    },
    async getPull(installationId, fullName, number) {
      const token = await installationToken(installationId);
      const p = await request<RawPullDetail>(`/repos/${fullName}/pulls/${number}`, `token ${token}`);
      return { ...toPullSummary(p), body: p.body ?? '', additions: p.additions ?? 0, deletions: p.deletions ?? 0, changedFiles: p.changed_files ?? 0 };
    },
    installUrl: (state) => `https://github.com/apps/${config.slug}/installations/new?state=${encodeURIComponent(state)}`,
  };
};
