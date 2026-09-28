import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sliceLines } from '../src/routes/code';
import { authed, createTestContext, signupVerified, type TestContext } from './helpers';

let ctx: TestContext;
beforeAll(async () => { ctx = await createTestContext(); });
beforeEach(() => ctx.reset());
afterAll(() => ctx.close());

const CONTENT = Array.from({ length: 1000 }, (_, i) => `line ${i + 1}`).join('\n');

const setup = async () => {
  const owner = await signupVerified(ctx);
  const org = (await ctx.app.inject({ method: 'POST', url: '/api/orgs', headers: authed(owner), payload: { name: 'Acme' } })).json();
  const repo = (await ctx.pool.query<{ id: string }>("insert into repos (org_id, full_name) values ($1, 'acme/api') returning id", [org.id])).rows[0]!.id;
  await ctx.pool.query("insert into source_files (repo_id, path, language, content) values ($1, 'src/big.ts', 'typescript', $2)", [repo, CONTENT]);
  return { owner, org };
};
const get = (who: { cookie: string }, orgId: string, query: string) => ctx.app.inject({ method: 'GET', url: `/api/orgs/${orgId}/code?${query}`, headers: { cookie: who.cookie } });

describe('sliceLines', () => {
  it('clamps the range to the file and to the maximum window', () => {
    expect(sliceLines('a\nb\nc', 2, 9)).toEqual({ startLine: 2, endLine: 3, snippet: 'b\nc' });
    expect(sliceLines('a\nb\nc', 0, 1)).toEqual({ startLine: 1, endLine: 1, snippet: 'a' });
    expect(sliceLines(CONTENT, 10, 5000).endLine).toBe(409);
    expect(sliceLines(CONTENT, 5000, 6000)).toEqual({ startLine: 1000, endLine: 1000, snippet: 'line 1000' });
  });
});

describe('GET /code', () => {
  it('returns a slice of an indexed file', async () => {
    const { owner, org } = await setup();
    const res = await get(owner, org.id, 'repo=acme/api&path=src/big.ts&start=3&end=5');
    expect(res.json()).toEqual({ repo: 'acme/api', path: 'src/big.ts', language: 'typescript', startLine: 3, endLine: 5, snippet: 'line 3\nline 4\nline 5' });
  });

  it('never exposes another organization or a missing file', async () => {
    const { org } = await setup();
    const other = await setup();
    expect((await get(other.owner, org.id, 'repo=acme/api&path=src/big.ts')).statusCode).toBe(404);
    expect((await get(other.owner, other.org.id, 'repo=acme/api&path=src/none.ts')).json()).toEqual({ error: { code: 'not_found' } });
  });
});
