import { linkInputsFromGraph, linkRepos } from '@rdi/indexer';
import type { GraphStore } from './store';

export const relinkOrg = async (store: GraphStore, orgId: string): Promise<number> => {
  const graph = await store.readOrgGraph(orgId);
  const links = linkRepos(linkInputsFromGraph(graph.nodes));
  await store.replaceOrgLinks(orgId, links);
  return links.length;
};
