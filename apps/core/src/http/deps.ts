import type { EventEmitter } from 'node:events';
import type { QueryFn } from '../agent/sdkRunner';
import type { Config } from '../config';

export type AppDeps = { config: Config; queryFn: QueryFn | null; events: EventEmitter; now?: () => Date };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
