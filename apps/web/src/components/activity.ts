import { useSyncExternalStore } from 'react';

/** What the agent is doing right now, shared by every panel so the canvas can show it. */
export type Activity = { busy: boolean; label: string | null; detail: string | null };

let state: Activity = { busy: false, label: null, detail: null };
let depth = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const set = (next: Activity) => {
  state = next;
  emit();
};

/** Marks the agent as busy until the returned function is called; nested activities keep the overlay up until the last one ends. */
export const beginActivity = (label: string): (() => void) => {
  depth += 1;
  set({ busy: true, label, detail: null });
  let ended = false;
  return () => {
    if (ended) return;
    ended = true;
    depth = Math.max(0, depth - 1);
    if (depth === 0) set({ busy: false, label: null, detail: null });
  };
};

export const setActivityDetail = (detail: string | null): void => {
  if (state.busy) set({ ...state, detail });
};

export const resetActivity = (): void => {
  depth = 0;
  set({ busy: false, label: null, detail: null });
};

export const useActivity = (): Activity => useSyncExternalStore((l) => (listeners.add(l), () => listeners.delete(l)), () => state, () => state);
