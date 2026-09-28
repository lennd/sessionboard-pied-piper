import { createVerify, generateKeyPairSync } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { createAppJwt, createGitHubClient, githubCloneUrl } from '../src/index';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const config = { appId: '12345', privateKey: privateKey.export({ type: 'pkcs1', format: 'pem' }).toString(), slug: 'repo-designer' };
const decode = (part: string) => JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));

describe('createAppJwt', () => {
  it('signs an RS256 JWT with the app id and a short lifetime', () => {
    const now = new Date('2026-09-28T12:00:00Z');
    const jwt = createAppJwt(config, now);
    const [header, payload, signature] = jwt.split('.');
    expect(decode(header!)).toEqual({ alg: 'RS256', typ: 'JWT' });
    const claims = decode(payload!);
    expect(claims.iss).toBe('12345');
    expect(claims.iat).toBe(now.getTime() / 1000 - 60);
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(600);
    const verifier = createVerify('RSA-SHA256');
    verifier.update(`${header}.${payload}`);
    expect(verifier.verify(publicKey, Buffer.from(signature!, 'base64url'))).toBe(true);
  });
});

describe('createGitHubClient', () => {
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

  it('exchanges the app JWT for an installation token and lists repositories with it', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_abc' }, 201))
      .mockResolvedValueOnce(json({ repositories: [{ full_name: 'acme/api', default_branch: 'main', private: true }] }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.listInstallationRepos(77)).toEqual([{ fullName: 'acme/api', defaultBranch: 'main', private: true }]);
    const [tokenUrl, tokenInit] = fetchMock.mock.calls[0]!;
    expect(tokenUrl).toBe('https://api.github.com/app/installations/77/access_tokens');
    expect(tokenInit.method).toBe('POST');
    expect(tokenInit.headers.authorization).toMatch(/^Bearer ey/);
    const [listUrl, listInit] = fetchMock.mock.calls[1]!;
    expect(listUrl).toBe('https://api.github.com/installation/repositories?per_page=100');
    expect(listInit.headers.authorization).toBe('token ghs_abc');
  });

  it('reads the installation account and builds the install url', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(json({ account: { login: 'acme' } }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.getInstallation(77)).toEqual({ accountLogin: 'acme' });
    expect(client.installUrl('s t')).toBe('https://github.com/apps/repo-designer/installations/new?state=s%20t');
  });

  it('surfaces GitHub errors without leaking tokens', async () => {
    const client = createGitHubClient(config, vi.fn().mockResolvedValue(json({ message: 'Bad credentials' }, 401)) as unknown as typeof fetch);
    await expect(client.installationToken(1)).rejects.toThrow('GitHub API 401: Bad credentials');
  });

  it('builds token clone urls', () => {
    expect(githubCloneUrl('acme/api', 'ghs_x')).toBe('https://x-access-token:ghs_x@github.com/acme/api.git');
  });
});
