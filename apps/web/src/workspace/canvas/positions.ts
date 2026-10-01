import type { Node, XYPosition } from '@xyflow/react';

export type Positions = Record<string, XYPosition>;

const STORAGE_PREFIX = 'rdi.positions.';

/** Every piece can be dragged; positions the user moved replace the automatic layout. */
export const applyPositions = (nodes: Node[], positions: Positions): Node[] =>
  nodes.map((node) => ({ ...node, draggable: true, position: positions[node.id] ?? node.position }));

export const absolutePosition = (nodes: Node[], id: string): XYPosition | null => {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  let node = byId.get(id);
  if (!node) return null;
  let x = 0;
  let y = 0;
  while (node) {
    x += node.position.x;
    y += node.position.y;
    node = node.parentId ? byId.get(node.parentId) : undefined;
  }
  return { x, y };
};

export const loadPositions = (sceneId: string): Positions => {
  try {
    const raw = localStorage.getItem(`${STORAGE_PREFIX}${sceneId}`);
    return raw ? (JSON.parse(raw) as Positions) : {};
  } catch {
    return {};
  }
};

export const savePositions = (sceneId: string, positions: Positions): void => {
  localStorage.setItem(`${STORAGE_PREFIX}${sceneId}`, JSON.stringify(positions));
};

export const clearPositions = (sceneId: string): void => {
  localStorage.removeItem(`${STORAGE_PREFIX}${sceneId}`);
};
