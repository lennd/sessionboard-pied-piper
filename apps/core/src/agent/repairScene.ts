type Obj = Record<string, unknown>;

const isObj = (value: unknown): value is Obj => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const list = (value: unknown): Obj[] => (Array.isArray(value) ? value.filter(isObj) : []);
const ids = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);

/**
 * Fixes rule slips models commonly make in scenes (dangling references, grouping internal pieces, complexity on
 * non-logic pieces, misplaced sub-steps) so a useful scene is not thrown away. Returns the fixes applied.
 */
export const repairScene = (input: unknown): { scene: unknown; fixes: string[] } => {
  if (!isObj(input)) return { scene: input, fixes: [] };
  const fixes = new Set<string>();
  const rawNodes = list(input.nodes);
  const nodeIds = new Set(rawNodes.map((n) => n.id));

  const nodes = rawNodes.map((n) => {
    let node = n;
    if (node.parent !== undefined && !nodeIds.has(node.parent)) {
      const { parent: _ignored, ...rest } = node;
      node = rest;
      fixes.add('removed parents that are not pieces of the scene');
    }
    if (node.complexity !== undefined && node.role !== 'logic') {
      const { complexity: _ignored, ...rest } = node;
      node = rest;
      fixes.add('removed complexity from non-logic pieces');
    }
    return node;
  });
  const topLevel = new Set(nodes.filter((n) => n.parent === undefined).map((n) => n.id));
  const withChildren = new Set(nodes.filter((n) => n.parent !== undefined).map((n) => n.parent));

  const rawEdges = list(input.edges);
  const edges = rawEdges.filter((e) => nodeIds.has(e.from) && nodeIds.has(e.to));
  if (edges.length < rawEdges.length) fixes.add('removed edges between missing pieces');
  const edgeIds = new Set(edges.map((e) => e.id));

  const knownNodes = (value: unknown) => {
    const all = ids(value);
    const kept = all.filter((id) => nodeIds.has(id));
    if (kept.length < all.length) fixes.add('removed references to missing pieces from steps');
    return kept;
  };

  const repairSteps = (steps: Obj[]): Obj[] =>
    steps.flatMap((step) => {
      let fixed: Obj = { ...step };
      if (step.focus !== undefined) fixed.focus = knownNodes(step.focus);
      if (step.highlight !== undefined) fixed.highlight = knownNodes(step.highlight);
      if (step.annotate !== undefined) fixed.annotate = list(step.annotate).filter((a) => nodeIds.has(a.nodeId));
      if (isObj(step.travel) && !edgeIds.has(step.travel.edgeId)) {
        const { travel: _ignored, ...rest } = fixed;
        fixed = rest;
        fixes.add('removed travels along missing edges');
      }
      const substeps = repairSteps(list(step.substeps));
      const expandValid = step.expand !== undefined && withChildren.has(step.expand);
      if (expandValid) return [{ ...fixed, substeps }];
      const { expand: _expand, substeps: _substeps, ...flat } = fixed;
      if (step.expand !== undefined || substeps.length > 0) fixes.add('moved sub-steps without a valid expand into the main walkthrough');
      return [flat, ...substeps];
    });

  const groups = input.groups === undefined ? undefined : list(input.groups)
    .map((g) => {
      const all = ids(g.nodeIds);
      const kept = all.filter((id) => topLevel.has(id));
      if (kept.length < all.length) fixes.add('removed internal or missing pieces from groups');
      return { ...g, nodeIds: kept };
    })
    .filter((g) => g.nodeIds.length > 0);

  const risks = input.risks === undefined ? undefined : list(input.risks)
    .map((r) => {
      const all = ids(r.nodeIds);
      const kept = all.filter((id) => nodeIds.has(id));
      if (kept.length < all.length) fixes.add('removed missing pieces from risks');
      return { ...r, nodeIds: kept };
    })
    .filter((r) => r.nodeIds.length > 0);

  const scene: Obj = { ...input, nodes, edges, steps: repairSteps(list(input.steps)) };
  if (groups) scene.groups = groups;
  if (risks) scene.risks = risks;
  return { scene, fixes: [...fixes] };
};
