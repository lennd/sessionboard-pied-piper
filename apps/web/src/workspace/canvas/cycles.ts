export type CycleEdge = { key: string; from: string; to: string };
export type Cycles = { nodes: Set<string>; edges: Set<string> };

/** Strongly connected components (Tarjan); every edge whose ends share a component with more than one node, or a self loop, is part of a cycle. */
export const findCycles = (edges: CycleEdge[]): Cycles => {
  const out = new Map<string, string[]>();
  for (const e of edges) {
    if (!out.has(e.from)) out.set(e.from, []);
    if (!out.has(e.to)) out.set(e.to, []);
    out.get(e.from)!.push(e.to);
  }
  const index = new Map<string, number>();
  const low = new Map<string, number>();
  const onStack = new Set<string>();
  const stack: string[] = [];
  const component = new Map<string, number>();
  let counter = 0;
  let components = 0;
  const visit = (v: string) => {
    index.set(v, counter);
    low.set(v, counter);
    counter += 1;
    stack.push(v);
    onStack.add(v);
    for (const w of out.get(v) ?? []) {
      if (!index.has(w)) {
        visit(w);
        low.set(v, Math.min(low.get(v)!, low.get(w)!));
      } else if (onStack.has(w)) {
        low.set(v, Math.min(low.get(v)!, index.get(w)!));
      }
    }
    if (low.get(v) === index.get(v)) {
      let w: string;
      do {
        w = stack.pop()!;
        onStack.delete(w);
        component.set(w, components);
      } while (w !== v);
      components += 1;
    }
  };
  for (const v of out.keys()) if (!index.has(v)) visit(v);
  const sizes = new Map<number, number>();
  for (const c of component.values()) sizes.set(c, (sizes.get(c) ?? 0) + 1);
  const cycles: Cycles = { nodes: new Set(), edges: new Set() };
  for (const e of edges) {
    const same = component.get(e.from) === component.get(e.to);
    if (same && (e.from === e.to || (sizes.get(component.get(e.from)!) ?? 0) > 1)) {
      cycles.edges.add(e.key);
      cycles.nodes.add(e.from);
      cycles.nodes.add(e.to);
    }
  }
  return cycles;
};
