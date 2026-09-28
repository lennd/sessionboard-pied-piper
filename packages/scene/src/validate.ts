import { sceneSchema, type Scene, type Step } from './schema';

export type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

const collectDuplicates = (items: { id: string }[], label: string, path: string, errors: string[]) => {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) errors.push(`${path}.${i}.id: duplicate ${label} id "${item.id}"`);
    seen.add(item.id);
  });
  return seen;
};

const checkNodes = (scene: Scene, nodeIds: Set<string>, errors: string[]) => {
  const parentOf = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  scene.nodes.forEach((node, i) => {
    if (node.parent && !nodeIds.has(node.parent)) errors.push(`nodes.${i}.parent: unknown node "${node.parent}"`);
    if (node.parent && nodeIds.has(node.parent)) {
      const seen = new Set<string>([node.id]);
      let cursor: string | undefined = node.parent;
      while (cursor) {
        if (seen.has(cursor)) {
          errors.push(`nodes.${i}.parent: parent cycle through "${node.id}"`);
          break;
        }
        seen.add(cursor);
        cursor = parentOf.get(cursor);
      }
    }
    if (node.complexity && node.role !== 'logic') errors.push(`nodes.${i}.complexity: only "logic" nodes can declare complexity`);
    if (node.code && node.code.endLine < node.code.startLine) errors.push(`nodes.${i}.code.endLine: must be >= startLine`);
  });
};

const checkGroups = (scene: Scene, nodeIds: Set<string>, errors: string[]) => {
  collectDuplicates(scene.groups, 'group', 'groups', errors);
  const parentOf = new Map(scene.nodes.map((n) => [n.id, n.parent]));
  const owner = new Map<string, string>();
  scene.groups.forEach((group, g) => {
    if (nodeIds.has(group.id)) errors.push(`groups.${g}.id: id "${group.id}" is already used by a node`);
    group.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: unknown node "${id}"`);
        return;
      }
      if (parentOf.get(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" is an internal piece; only top-level nodes can be grouped`);
        return;
      }
      const previous = owner.get(id);
      if (previous) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" already belongs to group "${previous}"`);
        return;
      }
      owner.set(id, group.id);
    });
  });
};

const checkSteps = (
  steps: Step[],
  path: string,
  ctx: { nodeIds: Set<string>; edgeIds: Set<string>; hasChildren: Set<string>; stepIds: Set<string> },
  errors: string[],
) =>
  steps.forEach((step, s) => {
    const here = `${path}.${s}`;
    if (ctx.stepIds.has(step.id)) errors.push(`${here}.id: duplicate step id "${step.id}"`);
    ctx.stepIds.add(step.id);
    const checkIds = (ids: string[], field: string) =>
      ids.forEach((id, i) => {
        if (!ctx.nodeIds.has(id)) errors.push(`${here}.${field}.${i}: unknown node "${id}"`);
      });
    checkIds(step.focus, 'focus');
    checkIds(step.highlight, 'highlight');
    step.annotate.forEach((a, i) => {
      if (!ctx.nodeIds.has(a.nodeId)) errors.push(`${here}.annotate.${i}.nodeId: unknown node "${a.nodeId}"`);
    });
    if (step.travel && !ctx.edgeIds.has(step.travel.edgeId)) errors.push(`${here}.travel.edgeId: unknown edge "${step.travel.edgeId}"`);
    if (step.expand) {
      if (!ctx.nodeIds.has(step.expand)) errors.push(`${here}.expand: unknown node "${step.expand}"`);
      else if (!ctx.hasChildren.has(step.expand)) errors.push(`${here}.expand: node "${step.expand}" has no internal pieces`);
    }
    if (step.substeps.length > 0 && !step.expand) errors.push(`${here}.substeps: sub-steps require "expand"`);
    checkSteps(step.substeps, `${here}.substeps`, ctx, errors);
  });

const checkReferences = (scene: Scene): string[] => {
  const errors: string[] = [];
  const nodeIds = collectDuplicates(scene.nodes, 'node', 'nodes', errors);
  const edgeIds = collectDuplicates(scene.edges, 'edge', 'edges', errors);
  collectDuplicates(scene.risks, 'risk', 'risks', errors);
  checkNodes(scene, nodeIds, errors);

  scene.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) errors.push(`edges.${i}.from: unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) errors.push(`edges.${i}.to: unknown node "${edge.to}"`);
  });

  checkGroups(scene, nodeIds, errors);

  const hasChildren = new Set(scene.nodes.flatMap((n) => (n.parent ? [n.parent] : [])));
  checkSteps(scene.steps, 'steps', { nodeIds, edgeIds, hasChildren, stepIds: new Set() }, errors);

  scene.risks.forEach((risk, r) =>
    risk.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) errors.push(`risks.${r}.nodeIds.${i}: unknown node "${id}"`);
    }),
  );
  return errors;
};

export const validateScene = (input: unknown): ValidationResult => {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`) };
  }
  const errors = checkReferences(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scene: parsed.data };
};
