import { describe, expect, it } from 'vitest';
import { linkInputsFromGraph, linkRepos, normalizePath } from '../src/index';
import { graphFor } from './fixtures';

describe('normalizePath', () => {
  it('normalizes parameters, origins, queries and trailing slashes', () => {
    expect(normalizePath('/api/orders/:id')).toBe('/api/orders/*');
    expect(normalizePath('/api/orders/${}')).toBe('/api/orders/*');
    expect(normalizePath('/items/{item_id}/')).toBe('/items/*');
    expect(normalizePath('http://shop-api:3000/api/Orders?x=1')).toBe('/api/orders');
  });
});

describe('linkRepos', () => {
  it('links web fetches to api endpoints across repos with the same method', async () => {
    const graphs = await Promise.all([graphFor('shop-web'), graphFor('shop-api'), graphFor('shop-worker')]);
    const links = linkRepos(linkInputsFromGraph(graphs.flatMap((g) => g.nodes)));
    expect(links.map((l) => `${l.from} -> ${l.to} (${l.props.confidence})`)).toEqual([
      'file:shop-web:src/api.ts -> ep:shop-api:POST /api/orders (0.9)',
      'file:shop-web:src/api.ts -> ep:shop-api:GET /api/orders/:id (0.9)',
    ]);
    expect(links.every((l) => l.type === 'CALLS_HTTP')).toBe(true);
  });

  it('ignores method mismatches and same-repo matches, and splits confidence', () => {
    const links = linkRepos([
      { repoId: 'a', outbound: [{ fileId: 'fa', method: 'GET', url: '/x' }, { fileId: 'fa', method: 'DELETE', url: '/y' }], endpoints: [{ id: 'ea', method: 'GET', path: '/x' }] },
      { repoId: 'b', outbound: [], endpoints: [{ id: 'eb', method: 'GET', path: '/x' }, { id: 'eb2', method: 'POST', path: '/y' }] },
      { repoId: 'c', outbound: [], endpoints: [{ id: 'ec', method: 'GET', path: '/x' }] },
    ]);
    expect(links.map((l) => `${l.to}:${l.props.confidence}`)).toEqual(['eb:0.45', 'ec:0.45']);
  });
});
