import type { FastifyReply } from 'fastify';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

export const fail = (reply: FastifyReply, status: number, code: string, extra: Record<string, unknown> = {}) =>
  reply.code(status).send({ error: { code, ...extra } });
