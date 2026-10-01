import { createGitHubClient, type GitHubAppConfig, type GitHubClient } from '@rdi/providers';
import type pg from 'pg';

type Loader = () => Promise<GitHubClient | null>;

/** Resolves the GitHub client per job: env App first, then (outside production) the manifest-created App in Postgres. */
export const createGithubLoader = ({ pool, envConfig, production, fetchImpl = fetch }: { pool: pg.Pool; envConfig: GitHubAppConfig | null; production: boolean; fetchImpl?: typeof fetch }): Loader => {
  const envClient = envConfig ? createGitHubClient(envConfig, fetchImpl) : null;
  const clients = new Map<string, GitHubClient>();
  return async () => {
    if (envClient) return envClient;
    if (production) return null;
    const row = (await pool.query<{ app_id: string; slug: string; private_key: string }>('select app_id, slug, private_key from github_app where id = 1')).rows[0];
    if (!row) return null;
    const key = `${row.app_id}|${row.slug}`;
    const existing = clients.get(key);
    if (existing) return existing;
    const created = createGitHubClient({ appId: row.app_id, privateKey: row.private_key, slug: row.slug }, fetchImpl);
    clients.set(key, created);
    return created;
  };
};
