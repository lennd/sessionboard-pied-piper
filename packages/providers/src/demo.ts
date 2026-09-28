import { join } from 'node:path';

export const DEMO_REPOS = [
  { fullName: 'acme-demo/shop-web', dir: 'shop-web', defaultBranch: 'main' },
  { fullName: 'acme-demo/shop-api', dir: 'shop-api', defaultBranch: 'main' },
  { fullName: 'acme-demo/shop-worker', dir: 'shop-worker', defaultBranch: 'main' },
];

export const isDemoRepo = (fullName: string): boolean => DEMO_REPOS.some((r) => r.fullName === fullName);

export const demoRepoPath = (fixturesDir: string, fullName: string): string | null => {
  const repo = DEMO_REPOS.find((r) => r.fullName === fullName);
  return repo ? join(fixturesDir, repo.dir) : null;
};
