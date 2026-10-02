import type { GraphStore } from '@rdi/graph';
import type { LlmClient } from '../agent/llm';
import type { ScopeGuard } from '../agent/scopeGuard';
import type { GitHubClient } from '@rdi/providers';
import type { Redis } from 'ioredis';
import type pg from 'pg';
import type { Config } from '../config';
import type { Mailer } from '../mail/mailer';
import type { IndexQueue } from '../queue/indexQueue';

export type AppDeps = { config: Config; pool: pg.Pool; redis: Redis; mailer: Mailer; now?: () => Date; graph?: GraphStore; indexQueue?: IndexQueue; github?: GitHubClient | null; llm?: LlmClient | null; fetch?: typeof fetch; scopeGuard?: ScopeGuard };

export const nowOf = (deps: AppDeps): Date => deps.now?.() ?? new Date();
