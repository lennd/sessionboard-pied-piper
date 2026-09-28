import { useEffect, useRef } from 'react';

export const usePlaybackClock = (playing: boolean, onTick: (deltaMs: number) => void): void => {
  const onTickRef = useRef(onTick);
  onTickRef.current = onTick;

  useEffect(() => {
    if (!playing) return;
    let frameId = 0;
    let last = performance.now();
    const loop = (now: number) => {
      onTickRef.current(now - last);
      last = now;
      frameId = requestAnimationFrame(loop);
    };
    frameId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameId);
  }, [playing]);
};
