import type { EventEmitter } from 'node:events';
import type { QueryFn } from '../agent/sdkRunner';
import type { RunRegistry } from '../runs/registry';
import type { Config } from '../config';

export type AppDeps = { config: Config; queryFn: QueryFn | null; events: EventEmitter; runs: RunRegistry; now?: () => Date };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
