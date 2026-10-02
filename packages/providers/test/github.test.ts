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

  it('lists the files of a pull request with an installation token', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_pr' }, 201))
      .mockResolvedValueOnce(json([{ filename: 'src/a.ts', status: 'modified', patch: '@@ -1 +1 @@', additions: 1 }]));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.listPullFiles(9, 'acme/api', 42)).toEqual([{ filename: 'src/a.ts', status: 'modified', additions: 1, deletions: 0, patch: '@@ -1 +1 @@' }]);
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/repos/acme/api/pulls/42/files?per_page=100');
    expect(fetchMock.mock.calls[1]![1].headers.authorization).toBe('token ghs_pr');
  });

  it('pages through installations with more than 100 repositories', async () => {
    const repos = (from: number, count: number) => Array.from({ length: count }, (_, i) => ({ full_name: `acme/r${from + i}`, default_branch: 'main', private: true }));
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_p' }, 201))
      .mockResolvedValueOnce(json({ total_count: 150, repositories: repos(0, 100) }))
      .mockResolvedValueOnce(json({ total_count: 150, repositories: repos(100, 50) }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    const listed = await client.listInstallationRepos(5);
    expect(listed).toHaveLength(150);
    expect(fetchMock.mock.calls[2]![0]).toBe('https://api.github.com/installation/repositories?per_page=100&page=2');
  });

  it('lists the open pull requests of a repository across pages', async () => {
    const pull = (n: number) => ({ number: n, title: `PR ${n}`, user: { login: 'hugo' }, draft: n === 2, head: { ref: `feature/${n}` }, base: { ref: 'main' }, updated_at: '2026-10-01T10:00:00Z', html_url: `https://github.com/acme/api/pull/${n}` });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_l' }, 201))
      .mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, i) => pull(i + 1))))
      .mockResolvedValueOnce(json([pull(101)]));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    const pulls = await client.listOpenPulls(9, 'acme/api');
    expect(pulls).toHaveLength(101);
    expect(pulls[1]).toEqual({ number: 2, title: 'PR 2', author: 'hugo', draft: true, headRef: 'feature/2', baseRef: 'main', updatedAt: '2026-10-01T10:00:00Z', url: 'https://github.com/acme/api/pull/2' });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/repos/acme/api/pulls?state=open&per_page=100');
    expect(fetchMock.mock.calls[2]![0]).toBe('https://api.github.com/repos/acme/api/pulls?state=open&per_page=100&page=2');
  });

  it('reads a pull request with its description and size', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_g' }, 201))
      .mockResolvedValueOnce(json({ number: 7, title: 'Rotate certs', user: { login: 'ana' }, draft: false, head: { ref: 'feat' }, base: { ref: 'main' }, updated_at: '2026-10-01T10:00:00Z', html_url: 'u', body: null, additions: 40, deletions: 2, changed_files: 3 }));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    expect(await client.getPull(9, 'acme/api', 7)).toEqual({ number: 7, title: 'Rotate certs', author: 'ana', draft: false, headRef: 'feat', baseRef: 'main', updatedAt: '2026-10-01T10:00:00Z', url: 'u', body: '', additions: 40, deletions: 2, changedFiles: 3 });
    expect(fetchMock.mock.calls[1]![0]).toBe('https://api.github.com/repos/acme/api/pulls/7');
  });

  it('pages through pull request files and keeps renames', async () => {
    const file = (i: number) => ({ filename: `f${i}.ts`, status: 'modified', additions: 1, deletions: 1 });
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(json({ token: 'ghs_f' }, 201))
      .mockResolvedValueOnce(json(Array.from({ length: 100 }, (_, i) => file(i))))
      .mockResolvedValueOnce(json([{ filename: 'new.ts', previous_filename: 'old.ts', status: 'renamed', additions: 0, deletions: 0 }]));
    const client = createGitHubClient(config, fetchMock as unknown as typeof fetch);
    const files = await client.listPullFiles(9, 'acme/api', 7);
    expect(files).toHaveLength(101);
    expect(files[100]).toEqual({ filename: 'new.ts', status: 'renamed', additions: 0, deletions: 0, previousFilename: 'old.ts' });
  });
});
