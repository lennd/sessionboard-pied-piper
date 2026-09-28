import type { Scene } from '../schema';
import { checkoutEn, checkoutEs } from './checkout';
import { iotTelemetry } from './iot-telemetry';

export { defineScene } from './define';

export const sampleScenes: Scene[] = [checkoutEs, checkoutEn, iotTelemetry];

export const sampleRegistry: Record<string, Scene> = Object.fromEntries(sampleScenes.map((s) => [s.id, s]));
