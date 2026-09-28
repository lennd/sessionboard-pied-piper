import { afterAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { createInfraChecks } from '../src/checks';
import { loadConfig } from '../src/config';

const infra = createInfraChecks(loadConfig());
const app = buildApp({ checks: infra.checks, onClose: infra.close });

afterAll(() => app.close());

describe('GET /health against docker infra (run `npm run infra:up` first)', () => {
  it('reports postgres, neo4j and redis healthy', async () => {
    const res = await app.inject({ method: 'GET', url: '/health' });
    expect(res.json()).toEqual({ status: 'ok', checks: { postgres: 'ok', neo4j: 'ok', redis: 'ok' } });
  });
});
