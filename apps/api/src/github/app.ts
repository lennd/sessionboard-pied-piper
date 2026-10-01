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

const cache = new WeakMap<object, Promise<ActiveGithubApp | null>>();

const load = async (deps: GithubDeps): Promise<ActiveGithubApp | null> => {
  if (deps.config.github && deps.github) return { source: 'env', config: deps.config.github, client: deps.github, htmlUrl: null, ownerLogin: null };
  if (deps.config.nodeEnv === PRODUCTION) return null;
  const row = await loadGithubAppRow(deps.pool);
  if (!row) return null;
  const config = { appId: row.appId, privateKey: row.privateKey, slug: row.slug, webhookSecret: row.webhookSecret, stateSecret: row.stateSecret };
  return { source: 'manifest', config, client: createGitHubClient({ appId: row.appId, privateKey: row.privateKey, slug: row.slug }, deps.fetch ?? fetch), htmlUrl: row.htmlUrl, ownerLogin: row.ownerLogin };
};

/** The active GitHub App: env configuration first, then (outside production) the manifest-created one. */
export const resolveGithubApp = (deps: GithubDeps): Promise<ActiveGithubApp | null> => {
  const cached = cache.get(deps);
  if (cached) return cached;
  const loading = load(deps);
  cache.set(deps, loading);
  loading.catch(() => cache.delete(deps));
  return loading;
};

export const forgetGithubApp = (deps: GithubDeps): void => {
  cache.delete(deps);
};

export const manifestAvailable = async (deps: GithubDeps): Promise<boolean> =>
  deps.config.nodeEnv !== PRODUCTION && !(await resolveGithubApp(deps));
