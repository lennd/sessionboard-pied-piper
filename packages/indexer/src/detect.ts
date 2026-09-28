import type { FileFacts } from './parse';

export type EndpointFact = { method: string; path: string; file: string; line: number };
export type OutboundFact = { method: string; url: string; file: string; line: number };
export type QueueFact = { name: string; role: 'producer' | 'consumer'; file: string; line: number };
export type TableFact = { name: string; access: 'read' | 'write'; file: string; line: number };
export type ConfigFact = { name: string; file: string };
export type Detections = { endpoints: EndpointFact[]; outbound: OutboundFact[]; queues: QueueFact[]; tables: TableFact[]; config: ConfigFact[] };

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete']);
const OUTBOUND_RECEIVERS = new Set(['axios', 'http', 'https', 'client', 'api', 'requests', 'httpx', 'session', 'got', 'ky', 'superagent']);
const SQL_START = /^\s*(select\b[\s\S]*\bfrom\b|insert\s+into\b|update\s+["`]?[a-z_][a-z0-9_]*["`]?\s+set\b|delete\s+from\b|with\s+[a-z_][a-z0-9_]*\s+as\b)/i;
const WRITE_SQL = /\b(?:insert\s+into|update|delete\s+from)\s+["`]?([a-z_][a-z0-9_]*)/gi;
const READ_SQL = /\bfrom\s+["`]?([a-z_][a-z0-9_]*)/gi;
const QUEUE_CTOR = /(^|\.)Queue$/;
const WORKER_CTOR = /(^|\.)Worker$/;

const methodOf = (callee: string) => {
  const last = callee.split('.').pop()?.toLowerCase() ?? '';
  return HTTP_METHODS.has(last) ? last.toUpperCase() : null;
};
const receiverOf = (callee: string) => callee.split('.').slice(-2, -1)[0]?.toLowerCase() ?? '';

const sqlTables = (sql: string): { name: string; access: 'read' | 'write' }[] => {
  if (!SQL_START.test(sql)) return [];
  const writes = [...sql.matchAll(WRITE_SQL)].map((m) => m[1]!.toLowerCase());
  if (writes.length > 0) return writes.map((name) => ({ name, access: 'write' as const }));
  return [...sql.matchAll(READ_SQL)].map((m) => ({ name: m[1]!.toLowerCase(), access: 'read' as const }));
};

export const detect = (files: FileFacts[]): Detections => {
  const result: Detections = { endpoints: [], outbound: [], queues: [], tables: [], config: [] };
  const seenTables = new Set<string>();
  for (const file of files) {
    for (const call of file.calls) {
      const arg0 = call.args[0] ?? null;
      const method = methodOf(call.callee);
      if (call.callee === 'fetch' && arg0) {
        result.outbound.push({ method: (call.options.method ?? 'GET').toUpperCase(), url: arg0, file: file.path, line: call.line });
      } else if (method && arg0 && OUTBOUND_RECEIVERS.has(receiverOf(call.callee))) {
        result.outbound.push({ method, url: arg0, file: file.path, line: call.line });
      } else if (method && arg0?.startsWith('/') && call.callee.includes('.')) {
        result.endpoints.push({ method, path: arg0, file: file.path, line: call.line });
      }
      if (arg0 && call.isNew && QUEUE_CTOR.test(call.callee)) result.queues.push({ name: arg0, role: 'producer', file: file.path, line: call.line });
      if (arg0 && WORKER_CTOR.test(call.callee)) result.queues.push({ name: arg0, role: 'consumer', file: file.path, line: call.line });
      for (const arg of call.args) {
        if (!arg) continue;
        for (const table of sqlTables(arg)) {
          const key = `${file.path}|${table.access}|${table.name}`;
          if (seenTables.has(key)) continue;
          seenTables.add(key);
          result.tables.push({ ...table, file: file.path, line: call.line });
        }
      }
    }
    for (const name of file.envKeys) result.config.push({ name, file: file.path });
  }
  return result;
};

export const describeDetections = (d: Detections): string => {
  const queues = new Set(d.queues.map((q) => q.name)).size;
  const tables = new Set(d.tables.map((t) => t.name)).size;
  return `${d.endpoints.length} endpoints · ${queues} queues · ${tables} tables`;
};
