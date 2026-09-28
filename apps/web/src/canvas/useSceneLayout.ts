import type { Scene } from '@rdi/scene';
import { useEffect, useState } from 'react';
import { layoutScene, type SceneLayout } from './layout';

export const useSceneLayout = (scene: Scene): SceneLayout | null => {
  const [layout, setLayout] = useState<{ sceneId: string; value: SceneLayout } | null>(null);

  useEffect(() => {
    let cancelled = false;
    layoutScene(scene).then((value) => {
      if (!cancelled) setLayout({ sceneId: scene.id, value });
    });
    return () => {
      cancelled = true;
    };
  }, [scene]);

  return layout?.sceneId === scene.id ? layout.value : null;
};
