import { defineScene } from './samples/define';
import { MAX_SCENE_NODES, type Scene, type SceneNode } from './schema';

const fingerprint = (n: SceneNode) => JSON.stringify([n.label, n.role, n.kind, n.summary, n.parent ?? null]);

export const diffScenes = (before: Scene, after: Scene): Scene => {
  const previous = new Map(before.nodes.map((n) => [n.id, n]));
  const current = new Set(after.nodes.map((n) => n.id));
  const nodes: SceneNode[] = after.nodes.map((n): SceneNode => {
    const old = previous.get(n.id);
    const change: SceneNode['change'] = !old ? 'added' : fingerprint(old) !== fingerprint(n) ? 'modified' : undefined;
    const { change: _ignored, ...rest } = n;
    return change ? { ...rest, change } : rest;
  });
  for (const old of before.nodes) {
    if (current.has(old.id)) continue;
    if (nodes.length >= MAX_SCENE_NODES) break;
    const { parent, change: _ignored, ...rest } = old;
    nodes.push({ ...rest, ...(parent && current.has(parent) ? { parent } : {}), change: 'removed' as const });
  }
  return defineScene({ ...after, id: `${after.id}-changes`.slice(0, 120), title: `${after.title} — changes`.slice(0, 120), nodes });
};
