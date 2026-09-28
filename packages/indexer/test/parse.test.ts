import { describe, expect, it } from 'vitest';
import { literalValue, parseFile, parseRepository, walkRepository, type FileFacts } from '../src/index';
import { fixture } from './fixtures';

const facts = async (repo: 'shop-web' | 'shop-api' | 'shop-worker') => parseRepository((await walkRepository(fixture(repo))).files);
const byPath = (all: FileFacts[], path: string) => all.find((f) => f.path === path)!;
const call = (f: FileFacts, callee: string) => f.calls.filter((c) => c.callee === callee);

describe('literalValue', () => {
  it('unquotes strings and normalizes template substitutions', () => {
    expect(literalValue("'x'", 'string')).toBe('x');
    expect(literalValue('"x y"', 'string')).toBe('x y');
    expect(literalValue('`/api/orders/${id}`', 'template_string')).toBe('/api/orders/${}');
    expect(literalValue('f"hi {x}"', 'string')).toBe('hi {x}');
    expect(literalValue('abc', 'identifier')).toBeNull();
  });
});

describe('parseFile (TypeScript)', () => {
  it('extracts imports, symbols, calls, constructors and env keys', async () => {
    const api = await facts('shop-api');
    const orders = byPath(api, 'src/orders.ts');
    expect(orders.imports).toEqual(['bullmq', './db']);
    expect(orders.symbols.map((s) => s.name)).toEqual(['createOrderHandler', 'getOrderHandler']);
    expect(call(orders, 'Queue')[0]).toMatchObject({ isNew: true, args: ['orders'] });
    expect(call(orders, 'db.query').map((c) => c.args[0])).toEqual([
      'insert into orders (items, status) values ($1, $2) returning id',
      'select id, status from orders where id = $1',
    ]);
    expect(call(orders, 'ordersQueue.add')[0]!.args[0]).toBe('process-order');
    const server = byPath(api, 'src/server.ts');
    expect(call(server, 'app.post')[0]).toMatchObject({ args: ['/api/orders', null], line: 6 });
    expect(server.envKeys).toEqual(['PORT']);
    expect(byPath(api, 'src/db.ts').envKeys).toEqual(['DATABASE_URL']);
  });

  it('reads object-literal options and template strings from fetch calls, and parses TSX', async () => {
    const web = await facts('shop-web');
    const api = byPath(web, 'src/api.ts');
    const fetches = call(api, 'fetch');
    expect(fetches.map((c) => [c.args[0], c.options.method ?? null])).toEqual([['/api/orders', 'POST'], ['/api/orders/${}', null]]);
    expect(api.symbols.map((s) => s.name)).toEqual(['createOrder', 'getOrder']);
    expect(byPath(web, 'src/Checkout.tsx').imports).toEqual(['./api']);
  });
});

describe('parseFile (Python)', () => {
  it('extracts imports, functions, calls, keyword-free args and env keys', async () => {
    const worker = byPath(await facts('shop-worker'), 'worker.py');
    expect(worker.imports).toEqual(['os', 'psycopg', 'requests', 'bullmq']);
    expect(worker.symbols.map((s) => [s.name, s.kind])).toEqual([['charge', 'function'], ['process', 'function']]);
    expect(call(worker, 'requests.post')[0]!.args[0]).toBe('https://api.stripe.com/v1/charges');
    expect(call(worker, 'Worker')[0]).toMatchObject({ isNew: false, args: ['orders', null] });
    expect(call(worker, 'conn.execute')[0]!.args[0]).toBe("update orders set status = 'paid' where id = %s");
    expect(worker.envKeys).toEqual(['STRIPE_KEY', 'DATABASE_URL']);
  });

  it('marks decorator calls (FastAPI style)', async () => {
    const f = await parseFile({ path: 'main.py', language: 'python', loc: 3, content: '@app.get("/items/{item_id}")\ndef read(item_id):\n    return item_id\n' });
    expect(f.calls[0]).toMatchObject({ callee: 'app.get', decorator: true, args: ['/items/{item_id}'] });
  });
});
