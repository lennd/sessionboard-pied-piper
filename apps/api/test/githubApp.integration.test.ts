import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadGithubAppRow, saveGithubApp } from '../src/db/queries/githubApp';
import { manifestAvailable, resolveGithubApp } from '../src/github/app';
import { createTestContext, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const app = {
  appId: '123', slug: 'repository-designer-abcd', name: 'Repository Designer abcd', htmlUrl: 'https://github.com/apps/repository-designer-abcd',
  ownerLogin: 'hugo', privateKey: '-----BEGIN RSA PRIVATE KEY-----\nx\n-----END RSA PRIVATE KEY-----\n', webhookSecret: 'whs', clientId: 'Iv1', clientSecret: 'cs', stateSecret: 'st',
};

describe('GitHub App resolution', () => {
  it('uses manifest-created credentials when no env App exists', async () => {
    const deps = { config: ctx.config, pool: ctx.pool, github: null };
    expect(await resolveGithubApp(deps)).toBeNull();
    expect(await manifestAvailable(deps)).toBe(true);
    await saveGithubApp(ctx.pool, app);
    const active = await resolveGithubApp(deps);
    expect(active).toMatchObject({ source: 'manifest', config: { appId: '123', slug: 'repository-designer-abcd', webhookSecret: 'whs', stateSecret: 'st' }, htmlUrl: app.htmlUrl, ownerLogin: 'hugo' });
    expect(active!.client.installUrl('s')).toBe('https://github.com/apps/repository-designer-abcd/installations/new?state=s');
    expect(await manifestAvailable(deps)).toBe(false);
    expect((await loadGithubAppRow(ctx.pool))!.slug).toBe('repository-designer-abcd');
    await expect(saveGithubApp(ctx.pool, app)).rejects.toThrow();
  });

  it('ignores stored credentials in production', async () => {
    await saveGithubApp(ctx.pool, app);
    const deps = { config: { ...ctx.config, nodeEnv: 'production' }, pool: ctx.pool, github: null };
    expect(await resolveGithubApp(deps)).toBeNull();
    expect(await manifestAvailable(deps)).toBe(false);
  });

  it('prefers an App configured through the environment', async () => {
    const client = { installationToken: async () => 't', listInstallationRepos: async () => [], getInstallation: async () => ({ accountLogin: 'a' }), installUrl: () => 'env', listPullFiles: async () => [] };
    const deps = { config: { ...ctx.config, github: { appId: '9', privateKey: 'k', slug: 'env-app', webhookSecret: 'w', stateSecret: 's' } }, pool: ctx.pool, github: client };
    expect(await resolveGithubApp(deps)).toMatchObject({ source: 'env', config: { slug: 'env-app' }, client });
    expect(await manifestAvailable(deps)).toBe(false);
  });
});
