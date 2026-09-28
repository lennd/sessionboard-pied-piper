import type { GraphEdge, GraphNode } from './repoGraph';

export type LinkInput = { repoId: string; outbound: { fileId: string; method: string; url: string }[]; endpoints: { id: string; method: string; path: string }[] };

const BASE_CONFIDENCE = 0.9;
const PARAM_SEGMENT = /^(:[^/]+|\{[^/]+\}|\$\{\}|<[^/]+>)$/;
const ORIGIN = /^[a-z]+:\/\/[^/]+/i;

export const normalizePath = (path: string): string => {
  const withoutOrigin = path.replace(ORIGIN, '');
  const withoutQuery = withoutOrigin.split(/[?#]/)[0] ?? '';
  const segments = withoutQuery.split('/').filter(Boolean).map((s) => (PARAM_SEGMENT.test(s) || s.includes('${}') ? '*' : s.toLowerCase()));
  return `/${segments.join('/')}`;
};

export const linkRepos = (repos: LinkInput[]): GraphEdge[] => {
  const links: GraphEdge[] = [];
  for (const repo of repos) {
    for (const call of repo.outbound) {
      const target = normalizePath(call.url);
      const matches = repos
        .filter((other) => other.repoId !== repo.repoId)
        .flatMap((other) => other.endpoints.filter((ep) => ep.method === call.method && normalizePath(ep.path) === target));
      const confidence = Math.round((BASE_CONFIDENCE / Math.max(matches.length, 1)) * 100) / 100;
      for (const ep of matches) links.push({ from: call.fileId, to: ep.id, type: 'CALLS_HTTP', props: { method: call.method, path: ep.path, confidence } });
    }
  }
  return links;
};

export const linkInputsFromGraph = (nodes: GraphNode[]): LinkInput[] => {
  const byRepo = new Map<string, LinkInput>();
  const entry = (repoId: string) => {
    const existing = byRepo.get(repoId);
    if (existing) return existing;
    const created: LinkInput = { repoId, outbound: [], endpoints: [] };
    byRepo.set(repoId, created);
    return created;
  };
  for (const node of nodes) {
    if (!node.repoId) continue;
    if (node.label === 'Endpoint') entry(node.repoId).endpoints.push({ id: node.id, method: String(node.props.method), path: String(node.props.path) });
    if (node.label === 'File' && Array.isArray(node.props.outbound)) {
      for (const call of node.props.outbound) {
        const [method, ...rest] = call.split(' ');
        if (method && rest.length) entry(node.repoId).outbound.push({ fileId: node.id, method, url: rest.join(' ') });
      }
    }
  }
  return [...byRepo.values()];
};
