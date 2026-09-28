import type { Scene } from '@rdi/scene';

export type NavState = { stack: string[] };

export const rootNav = (sceneId: string): NavState => ({ stack: [sceneId] });

export const currentSceneId = (nav: NavState): string => nav.stack[nav.stack.length - 1] as string;

export const enterZoom = (nav: NavState, scene: Scene, nodeId: string, registry: Record<string, Scene>): NavState => {
  const target = scene.zoom?.[nodeId];
  if (!target || !registry[target]) return nav;
  return { stack: [...nav.stack, target] };
};

export const goToDepth = (nav: NavState, depth: number): NavState =>
  depth >= 0 && depth < nav.stack.length - 1 ? { stack: nav.stack.slice(0, depth + 1) } : nav;
