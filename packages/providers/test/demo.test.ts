import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { DEMO_REPOS, demoRepoPath, isDemoRepo } from '../src/index';

const FIXTURES = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));

describe('demo repositories', () => {
  it('maps demo names to bundled fixture directories', () => {
    expect(DEMO_REPOS.map((r) => r.fullName)).toEqual(['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']);
    DEMO_REPOS.forEach((r) => expect(existsSync(demoRepoPath(FIXTURES, r.fullName)!)).toBe(true));
    expect(isDemoRepo('acme-demo/shop-api')).toBe(true);
    expect(isDemoRepo('acme/api')).toBe(false);
    expect(demoRepoPath(FIXTURES, 'acme-demo/../../etc')).toBeNull();
  });
});
