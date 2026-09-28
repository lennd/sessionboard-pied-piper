import type { Detections } from './detect';
import type { FileFacts } from './parse';

export type Summarizer = {
  service(input: { name: string; languages: string[]; files: number; detections: Detections }): string;
  endpoint(method: string, path: string, file: string): string;
  file(facts: FileFacts): string;
  queue(name: string): string;
  table(name: string): string;
  external(host: string): string;
  config(name: string): string;
};

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export const heuristicSummarizer: Summarizer = {
  service: ({ name, languages, files, detections }) => {
    const parts = [`${name} (${languages.join(', ') || 'unknown language'}) with ${plural(files, 'source file')}`];
    if (detections.endpoints.length) parts.push(`${detections.endpoints.length} HTTP endpoints`);
    const produced = new Set(detections.queues.filter((q) => q.role === 'producer').map((q) => q.name));
    const consumed = new Set(detections.queues.filter((q) => q.role === 'consumer').map((q) => q.name));
    if (produced.size) parts.push(`publishes to ${[...produced].join(', ')}`);
    if (consumed.size) parts.push(`consumes ${[...consumed].join(', ')}`);
    const tables = new Set(detections.tables.map((t) => t.name));
    if (tables.size) parts.push(`uses ${plural(tables.size, 'table')} (${[...tables].join(', ')})`);
    return `${parts.join('; ')}.`;
  },
  endpoint: (method, path, file) => `Handles ${method} ${path} in ${file}.`,
  file: (facts) => `${facts.path}: ${plural(facts.symbols.length, 'symbol')}${facts.symbols.length ? ` (${facts.symbols.slice(0, 5).map((s) => s.name).join(', ')})` : ''}.`,
  queue: (name) => `Message queue "${name}".`,
  table: (name) => `Database table "${name}".`,
  external: (host) => `External service at ${host}.`,
  config: (name) => `Environment variable ${name}.`,
};
