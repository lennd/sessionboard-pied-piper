import { useEffect, useState } from 'react';
import type { SceneLayout } from './layout';

type Settled = { signature: string; layout: SceneLayout | null; error: string | null };

export const useSceneLayout = (signature: string, compute: () => Promise<SceneLayout>) => {
  const [settled, setSettled] = useState<Settled | null>(null);

  useEffect(() => {
    let cancelled = false;
    compute().then(
      (layout) => { if (!cancelled) setSettled({ signature, layout, error: null }); },
      (error: unknown) => { if (!cancelled) setSettled({ signature, layout: null, error: error instanceof Error ? error.message : String(error) }); },
    );
    return () => { cancelled = true; };
    // compute is recreated every render; the signature is the cache key.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature]);

  return settled?.signature === signature ? { layout: settled.layout, error: settled.error } : { layout: null, error: null };
};
