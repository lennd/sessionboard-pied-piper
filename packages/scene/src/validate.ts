import { sceneSchema, type Scene } from './schema';

export type ValidationResult = { ok: true; scene: Scene } | { ok: false; errors: string[] };

const KINDS_REQUIRING_STEPS = new Set<Scene['kind']>(['flow', 'algorithm']);

const checkIdList = (ids: string[], known: Set<string>, path: string, errors: string[]) =>
  ids.forEach((id, i) => {
    if (!known.has(id)) errors.push(`${path}.${i}: unknown node "${id}"`);
  });

const collectDuplicates = (items: { id: string }[], label: string, path: string, errors: string[]) => {
  const seen = new Set<string>();
  items.forEach((item, i) => {
    if (seen.has(item.id)) errors.push(`${path}.${i}.id: duplicate ${label} id "${item.id}"`);
    seen.add(item.id);
  });
  return seen;
};

const checkReferences = (scene: Scene): string[] => {
  const errors: string[] = [];
  const nodeIds = collectDuplicates(scene.nodes, 'node', 'nodes', errors);
  const edgeIds = collectDuplicates(scene.edges, 'edge', 'edges', errors);
  const nodeTypes = new Map(scene.nodes.map((n) => [n.id, n.type]));

  scene.edges.forEach((edge, i) => {
    if (!nodeIds.has(edge.from)) errors.push(`edges.${i}.from: unknown node "${edge.from}"`);
    if (!nodeIds.has(edge.to)) errors.push(`edges.${i}.to: unknown node "${edge.to}"`);
  });

  collectDuplicates(scene.groups, 'group', 'groups', errors);
  scene.groups.forEach((group, g) => {
    if (nodeIds.has(group.id)) errors.push(`groups.${g}.id: id "${group.id}" is already used by a node`);
  });

  const owner = new Map<string, string>();
  scene.groups.forEach((group, g) =>
    group.nodeIds.forEach((id, i) => {
      if (!nodeIds.has(id)) {
        errors.push(`groups.${g}.nodeIds.${i}: unknown node "${id}"`);
        return;
      }
      const previous = owner.get(id);
      if (previous) {
        errors.push(`groups.${g}.nodeIds.${i}: node "${id}" already belongs to group "${previous}"`);
        return;
      }
      owner.set(id, group.id);
    }),
  );

  scene.steps.forEach((step, s) => {
    checkIdList(step.focus, nodeIds, `steps.${s}.focus`, errors);
    checkIdList(step.highlight, nodeIds, `steps.${s}.highlight`, errors);
    step.annotate.forEach((a, i) => {
      if (!nodeIds.has(a.nodeId)) errors.push(`steps.${s}.annotate.${i}.nodeId: unknown node "${a.nodeId}"`);
    });
    if (step.travel && !edgeIds.has(step.travel.edgeId)) {
      errors.push(`steps.${s}.travel.edgeId: unknown edge "${step.travel.edgeId}"`);
    }
  });

  Object.entries(scene.zoom ?? {}).forEach(([nodeId, sceneId]) => {
    if (!nodeIds.has(nodeId)) errors.push(`zoom.${nodeId}: unknown node "${nodeId}"`);
    if (sceneId === scene.id) errors.push(`zoom.${nodeId}: a scene cannot zoom into itself`);
  });

  if (KINDS_REQUIRING_STEPS.has(scene.kind) && scene.steps.length === 0) {
    errors.push(`steps: a "${scene.kind}" scene needs at least one step`);
  }

  if (scene.kind === 'load' && !scene.load) errors.push('load: a "load" scene needs a load config');
  if (scene.load) {
    Object.keys(scene.load.nodes).forEach((id) => {
      if (!nodeIds.has(id)) errors.push(`load.nodes.${id}: unknown node "${id}"`);
    });
    Object.keys(scene.load.queues ?? {}).forEach((id) => {
      if (!nodeIds.has(id)) errors.push(`load.queues.${id}: unknown node "${id}"`);
      else if (nodeTypes.get(id) !== 'queue') errors.push(`load.queues.${id}: node "${id}" is not a queue`);
    });
  }

  return errors;
};

export const validateScene = (input: unknown): ValidationResult => {
  const parsed = sceneSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`),
    };
  }
  const errors = checkReferences(parsed.data);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, scene: parsed.data };
};
