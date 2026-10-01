import { generateKeyPairSync, randomUUID } from 'node:crypto';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createGithubLoader } from '../src/github';
import { loadRepo } from '../src/repoStore';
import { createSourceResolver } from '../src/sources';
import { WORKER_TEST_DB } from './setup/globalSetup';

const pool = new pg.Pool({ connectionString: WORKER_TEST_DB });
const PEM = generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey.export({ type: 'pkcs1', format: 'pem' }).toString();
const fakeGithub: typeof fetch = async (input) => {
  const match = /\/app\/installations\/(\d+)\/access_tokens$/.exec(String(input));
  return new Response(JSON.stringify(match ? { token: `tok-${match[1]}` } : { message: 'Not Found' }), { status: match ? 201 : 404 });
};
let orgId: string;
const repoIds: Record<string, string> = {};

beforeAll(async () => {
  await pool.query('delete from github_app');
  orgId = (await pool.query<{ id: string }>("insert into orgs (name, slug) values ('G', $1) returning id", [`g-${randomUUID()}`])).rows[0]!.id;
  for (const [installation, fullName] of [[11 + Math.floor(Math.random() * 1e6), 'hugo/notes'], [22 + Math.floor(Math.random() * 1e6), 'lennd/api']] as const) {
    const inst = (await pool.query<{ id: string }>("insert into github_installations (org_id, installation_id, account_login) values ($1, $2, 'x') returning id", [orgId, installation])).rows[0]!.id;
    repoIds[fullName] = (await pool.query<{ id: string }>('insert into repos (org_id, full_name, installation_id) values ($1, $2, $3) returning id', [orgId, fullName, inst])).rows[0]!.id;
  }
});

afterAll(async () => {
  await pool.query('delete from github_app');
  await pool.query('delete from orgs where id = $1', [orgId]);
  await pool.end();
});

describe('GitHub sources', () => {
  it('fails clearly when no GitHub App is configured', async () => {
    const resolve = createSourceResolver({ fixturesDir: '/nope', github: createGithubLoader({ pool, envConfig: null, production: false, fetchImpl: fakeGithub }) });
    await expect(resolve((await loadRepo(pool, repoIds['hugo/notes']!))!)).rejects.toThrow('GitHub App is not configured');
  });

  it('clones each repository with the token of its own installation using the manifest-created App', async () => {
    await pool.query(
      "insert into github_app (app_id, slug, name, html_url, owner_login, private_key, webhook_secret, client_id, client_secret, state_secret) values ('77', 'rd-test', 'RD', 'https://github.com/apps/rd-test', 'hugo', $1, 'w', 'c', 's', 'st')",
      [PEM],
    );
    const resolve = createSourceResolver({ fixturesDir: '/nope', github: createGithubLoader({ pool, envConfig: null, production: false, fetchImpl: fakeGithub }) });
    for (const fullName of ['hugo/notes', 'lennd/api']) {
      const repo = (await loadRepo(pool, repoIds[fullName]!))!;
      expect(await resolve(repo)).toEqual({ kind: 'git', url: `https://x-access-token:tok-${repo.githubInstallationId}@github.com/${fullName}.git`, branch: 'main' });
    }
  });

  it('ignores stored credentials in production', async () => {
    const loader = createGithubLoader({ pool, envConfig: null, production: true, fetchImpl: fakeGithub });
    expect(await loader()).toBeNull();
  });
});
