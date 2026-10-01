import { createGitHubClient, type GitHubClient } from '@rdi/providers';
import type pg from 'pg';
import type { Config } from '../config';
import { loadGithubAppRow } from '../db/queries/githubApp';

const PRODUCTION = 'production';

type GithubDeps = { config: Config; pool: pg.Pool; github?: GitHubClient | null; fetch?: typeof fetch };
export type ActiveGithubApp = {
  source: 'env' | 'manifest';
  config: { appId: string; privateKey: string; slug: string; webhookSecret: string; stateSecret: string };
  client: GitHubClient;
  htmlUrl: string | null;
  ownerLogin: string | null;
};

const clients = new Map<string, GitHubClient>();

const clientFor = (row: { appId: string; privateKey: string; slug: string }, fetchImpl: typeof fetch): GitHubClient => {
  const key = `${row.appId}|${row.slug}`;
  const existing = clients.get(key);
  if (existing) return existing;
  const created = createGitHubClient({ appId: row.appId, privateKey: row.privateKey, slug: row.slug }, fetchImpl);
  clients.set(key, created);
  return created;
};

/** The active GitHub App: env configuration first, then (outside production) the manifest-created one. */
export const resolveGithubApp = async (deps: GithubDeps): Promise<ActiveGithubApp | null> => {
  if (deps.config.github && deps.github) return { source: 'env', config: deps.config.github, client: deps.github, htmlUrl: null, ownerLogin: null };
  if (deps.config.nodeEnv === PRODUCTION) return null;
  const row = await loadGithubAppRow(deps.pool);
  if (!row) return null;
  const config = { appId: row.appId, privateKey: row.privateKey, slug: row.slug, webhookSecret: row.webhookSecret, stateSecret: row.stateSecret };
  return { source: 'manifest', config, client: clientFor(row, deps.fetch ?? fetch), htmlUrl: row.htmlUrl, ownerLogin: row.ownerLogin };
};

export const manifestAvailable = async (deps: GithubDeps): Promise<boolean> =>
  deps.config.nodeEnv !== PRODUCTION && !(await resolveGithubApp(deps));
