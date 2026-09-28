import type { GraphStore } from './store';

export const relinkOrg = (store: GraphStore, orgId: string): Promise<number> => store.relink(orgId);
