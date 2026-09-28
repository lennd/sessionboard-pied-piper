import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../config';
import type { Mailer } from '../mail/mailer';

export type AppDeps = { config: Config; pool: pg.Pool; redis: Redis; mailer: Mailer; now?: () => Date };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
