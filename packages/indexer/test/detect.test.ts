import { describe, expect, it } from 'vitest';
import { describeDetections, detect, parseRepository, walkRepository, type FileFacts } from '../src/index';
import { fixture } from './fixtures';

const detectRepo = async (repo: 'shop-web' | 'shop-api' | 'shop-worker') => detect(await parseRepository((await walkRepository(fixture(repo))).files));
const facts = (calls: Partial<FileFacts['calls'][number]>[]): FileFacts[] => [
  { path: 'x.ts', language: 'typescript', loc: 1, imports: [], symbols: [], envKeys: [], calls: calls.map((c) => ({ callee: '', line: 1, args: [], options: {}, isNew: false, decorator: false, ...c })) },
];

describe('detect', () => {
  it('finds express endpoints, the producer queue, table access and config in shop-api', async () => {
    const d = await detectRepo('shop-api');
    expect(d.endpoints.map((e) => `${e.method} ${e.path} @${e.file}`)).toEqual(['POST /api/orders @src/server.ts', 'GET /api/orders/:id @src/server.ts']);
    expect(d.queues).toEqual([{ name: 'orders', role: 'producer', file: 'src/orders.ts', line: 4 }]);
    expect(d.tables.map((t) => `${t.access}:${t.name}`)).toEqual(['write:orders', 'read:orders']);
    expect(d.config.map((c) => `${c.name}@${c.file}`)).toEqual(['DATABASE_URL@src/db.ts', 'PORT@src/server.ts']);
    expect(d.outbound).toEqual([]);
    expect(describeDetections(d)).toBe('2 endpoints · 1 queues · 1 tables');
  });

  it('finds outbound calls from the web app', async () => {
    const d = await detectRepo('shop-web');
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['POST /api/orders', 'GET /api/orders/${}']);
    expect(d.endpoints).toEqual([]);
  });

  it('finds the consumer, external call, table write and config in the python worker', async () => {
    const d = await detectRepo('shop-worker');
    expect(d.queues).toEqual([{ name: 'orders', role: 'consumer', file: 'worker.py', line: 20 }]);
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['POST https://api.stripe.com/v1/charges']);
    expect(d.tables.map((t) => `${t.access}:${t.name}`)).toEqual(['write:orders']);
    expect(d.config.map((c) => c.name)).toEqual(['STRIPE_KEY', 'DATABASE_URL']);
  });

  it('does not confuse http clients with routes, nor prose with SQL', () => {
    const d = detect(facts([
      { callee: 'axios.get', args: ['/api/users'] },
      { callee: 'router.delete', args: ['/api/users/:id'] },
      { callee: 'toast.show', args: ['update your profile'] },
      { callee: 'app.get', args: ['/items/{id}'], decorator: true },
    ]));
    expect(d.outbound.map((o) => `${o.method} ${o.url}`)).toEqual(['GET /api/users']);
    expect(d.endpoints.map((e) => `${e.method} ${e.path}`)).toEqual(['DELETE /api/users/:id', 'GET /items/{id}']);
    expect(d.tables).toEqual([]);
  });
});
