import type { Scene } from '@rdi/scene';
import { useEffect, useState } from 'react';
import { layoutScene, type SceneLayout } from './layout';

export type SceneLayoutState = { layout: SceneLayout | null; error: string | null };

type Settled = { sceneId: string; layout: SceneLayout | null; error: string | null };

const PENDING: SceneLayoutState = { layout: null, error: null };

export const useSceneLayout = (scene: Scene): SceneLayoutState => {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    layoutScene(scene).then(
      (layout) => {
        if (!cancelled) setSettled({ sceneId: scene.id, layout, error: null });
      },
      (error: unknown) => {
        if (!cancelled) setSettled({ sceneId: scene.id, layout: null, error: error instanceof Error ? error.message : String(error) });
      },
    );
    return () => {
      cancelled = true;
    };
  }, [scene]);

  return settled?.sceneId === scene.id ? { layout: settled.layout, error: settled.error } : PENDING;
};
