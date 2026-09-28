import type { Scene } from '../schema';
import { prImpact } from './pr-impact';
import { speakerReconcileAlgorithm } from './speaker-reconcile-algorithm';
import { speakerSyncFlow } from './speaker-sync-flow';
import { speakerSyncLoad } from './speaker-sync-load';

export { defineScene } from './define';

export const sampleScenes: Scene[] = [speakerSyncFlow, speakerReconcileAlgorithm, speakerSyncLoad, prImpact];

export const sampleSceneRegistry: Record<string, Scene> = Object.fromEntries(sampleScenes.map((s) => [s.id, s]));
