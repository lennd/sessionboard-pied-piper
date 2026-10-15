import { useReactFlow } from '@xyflow/react';
import { useEffect, useRef } from 'react';
import type { CameraShot } from './cameraTargets';

const DURATION_MS = 650;
const FOCUS_PADDING = 0.28;
const ALL_PADDING = 0.12;
const MAX_ZOOM = 1.05;

const reducedMotion = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Moves the camera when the shot changes (or when `nudge` ticks, e.g. on play): zooms onto the pieces of the current step or risk, pulls back when nothing is focused. */
export const CameraDirector = ({ shot, ready, nudge = 0 }: { shot: CameraShot; ready: boolean; nudge?: number }) => {
  const { fitView } = useReactFlow();
  const last = useRef<string | null>(null);
  useEffect(() => {
    const key = `${shot.key}#${nudge}`;
    if (!ready || last.current === key) return;
    const first = last.current === null;
    last.current = key;
    if (first && shot.nodeIds.length === 0) return;
    const duration = reducedMotion() ? 0 : DURATION_MS;
    const frame = () => {
      if (shot.nodeIds.length === 0) void fitView({ duration, padding: ALL_PADDING });
      else void fitView({ duration, padding: FOCUS_PADDING, maxZoom: MAX_ZOOM, nodes: shot.nodeIds.map((id) => ({ id })) });
    };
    const timer = window.setTimeout(frame, 0);
    return () => window.clearTimeout(timer);
  }, [shot, ready, nudge, fitView]);
  return null;
};
