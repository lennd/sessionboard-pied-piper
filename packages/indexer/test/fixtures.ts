import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, parseRepository, walkRepository } from '../src/index';

export const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
export const fixture = (name: 'shop-web' | 'shop-api' | 'shop-worker') => `${FIXTURES_DIR}/${name}`;

export const TEST_ORG = 'org-1';

export const graphFor = async (repo: 'shop-web' | 'shop-api' | 'shop-worker', repoId: string = repo) => {
  const walk = await walkRepository(fixture(repo));
  const facts = await parseRepository(walk.files);
  return buildRepoGraph({ orgId: TEST_ORG, repoId, fullName: `acme-demo/${repo}`, walk, facts, detections: detect(facts) });
};
