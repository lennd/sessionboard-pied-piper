import { fileURLToPath } from 'node:url';
import { buildRepoGraph, detect, linkInputsFromGraph, linkRepos, parseRepository, walkRepository, type OrgGraph } from '@rdi/indexer';

const FIXTURES = fileURLToPath(new URL('../../../../fixtures/repos', import.meta.url));
export const TEST_ORG_ID = 'org-t';
export const REPOS = ['shop-web', 'shop-api', 'shop-worker'] as const;

export const fixtureSources = async (): Promise<Map<string, { content: string; language: string }>> => {
  const map = new Map<string, { content: string; language: string }>();
  for (const repo of REPOS) {
    for (const f of (await walkRepository(`${FIXTURES}/${repo}`)).files) map.set(`acme-demo/${repo}|${f.path}`, { content: f.content, language: f.language });
  }
  return map;
};

export const fixtureOrgGraph = async (): Promise<OrgGraph> => {
  const graphs = [];
  for (const repo of REPOS) {
    const walk = await walkRepository(`${FIXTURES}/${repo}`);
    const facts = await parseRepository(walk.files);
    graphs.push(buildRepoGraph({ orgId: TEST_ORG_ID, repoId: repo, fullName: `acme-demo/${repo}`, walk, facts, detections: detect(facts) }));
  }
  const nodes = [...new Map(graphs.flatMap((g) => g.nodes).map((n) => [n.id, n])).values()];
  return { nodes, edges: [...graphs.flatMap((g) => g.edges), ...linkRepos(linkInputsFromGraph(nodes))] };
};
