import { isAbsolute, relative, sep } from 'node:path';

export type EventStatus = 'pending' | 'ok' | 'error';
export type FileChange = 'added' | 'modified' | 'removed';
type Base = { id: string; ts: string; sidechain: boolean };
export type TimelineEvent =
  | (Base & { kind: 'prompt'; text: string })
  | (Base & { kind: 'text'; text: string })
  | (Base & { kind: 'edit' | 'write'; file: string; path: string | null; change: FileChange; oldText: string; newText: string; status: EventStatus })
  | (Base & { kind: 'bash'; command: string; description: string | null; git: string | null; status: EventStatus })
  | (Base & { kind: 'read'; tool: string; target: string; status: EventStatus })
  | (Base & { kind: 'subagent'; description: string; status: EventStatus })
  | (Base & { kind: 'tool'; tool: string; summary: string; status: EventStatus });

export type TouchedFile = { path: string; change: FileChange };
export type SessionMeta = { id: string; title: string | null; slug: string | null; cwd: string | null; startedAt: string | null; updatedAt: string | null; version: string | null; origin: 'terminal' | 'app'; kind: string | null };

const MAX_TEXT = 600;
const MAX_PROMPT = 400;
const READ_TOOLS = new Set(['Read', 'Grep', 'Glob', 'LS', 'ReadMcpResourceTool']);
const GIT_VERB = /^\s*git\s+(?:-C\s+\S+\s+)?([a-z-]+)/;
const GIT_SUBCOMMAND_PATTERN = /(?:^|&&|;|\|\|)\s*git\s+(?:-C\s+\S+\s+)?(commit|checkout|switch|merge|rebase|reset|stash|push|pull|rm|mv|revert|cherry-pick)\b/;
const SYSTEM_PROMPT_PREFIX = /^<(command-name|local-command|system-reminder|command-message)/;
const APP_MARKER = /^\[rdi:([a-z-]+)\]/;

type Record_ = {
  type?: string;
  uuid?: string;
  timestamp?: string;
  isSidechain?: boolean;
  cwd?: string;
  sessionId?: string;
  version?: string;
  slug?: string;
  message?: { role?: string; content?: unknown };
  toolUseResult?: unknown;
};
type Block = { type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown>; tool_use_id?: string; content?: unknown; is_error?: boolean };

const clip = (text: string, max: number) => (text.length <= max ? text : `${text.slice(0, max - 1)}…`);

/** Repository-relative path (posix) or null when the file lives outside the repository. */
export const relativeTo = (repoPath: string, file: string): string | null => {
  if (!isAbsolute(file)) return file.split(sep).join('/');
  const rel = relative(repoPath, file);
  return rel && !rel.startsWith('..') && !isAbsolute(rel) ? rel.split(sep).join('/') : null;
};

const gitVerbOf = (command: string): string | null => GIT_SUBCOMMAND_PATTERN.exec(command)?.[1] ?? GIT_VERB.exec(command)?.[1] ?? null;

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export const parseLine = (line: string): Record_ | null => {
  try {
    const value = JSON.parse(line) as unknown;
    return value && typeof value === 'object' ? (value as Record_) : null;
  } catch {
    return null;
  }
};

/** Incremental parser for one Claude Code transcript (.jsonl). Feed it lines; read `events` or the changes returned by `push`. */
export const createSessionParser = (repoPath: string) => {
  const events: TimelineEvent[] = [];
  const byToolUse = new Map<string, number>();
  const meta: SessionMeta = { id: '', title: null, slug: null, cwd: null, startedAt: null, updatedAt: null, version: null, origin: 'terminal', kind: null };
  const titleFrom = (text: string) => {
    const marker = APP_MARKER.exec(text);
    if (marker) {
      meta.origin = 'app';
      meta.kind = marker[1] ?? null;
      return null;
    }
    return clip(text.split('\n')[0] ?? '', 80);
  };

  const upsert = (event: TimelineEvent): TimelineEvent => {
    events.push(event);
    return event;
  };

  const fromToolUse = (block: Block, base: Base): TimelineEvent | null => {
    const input = block.input ?? {};
    const name = block.name ?? 'tool';
    if (name === 'Edit' || name === 'MultiEdit') {
      const file = str(input.file_path);
      return { ...base, kind: 'edit', file, path: relativeTo(repoPath, file), change: 'modified', oldText: str(input.old_string), newText: str(input.new_string), status: 'pending' };
    }
    if (name === 'Write' || name === 'NotebookEdit') {
      const file = str(input.file_path ?? input.notebook_path);
      return { ...base, kind: 'write', file, path: relativeTo(repoPath, file), change: 'modified', oldText: '', newText: str(input.content ?? input.new_source), status: 'pending' };
    }
    if (name === 'Bash') {
      const command = str(input.command);
      return { ...base, kind: 'bash', command, description: typeof input.description === 'string' ? input.description : null, git: gitVerbOf(command), status: 'pending' };
    }
    if (READ_TOOLS.has(name)) {
      const raw = str(input.file_path ?? input.pattern ?? input.path ?? input.uri);
      const target = isAbsolute(raw) ? (relativeTo(repoPath, raw) ?? raw) : raw;
      return { ...base, kind: 'read', tool: name, target, status: 'pending' };
    }
    if (name === 'Agent' || name === 'Task') return { ...base, kind: 'subagent', description: str(input.description) || str(input.prompt).slice(0, 80), status: 'pending' };
    const summary = [input.skill, input.query, input.url, input.file_path].find((v) => typeof v === 'string') as string | undefined;
    return { ...base, kind: 'tool', tool: name, summary: summary ?? '', status: 'pending' };
  };

  const applyResult = (block: Block, result: unknown): TimelineEvent | null => {
    const index = block.tool_use_id ? byToolUse.get(block.tool_use_id) : undefined;
    if (index === undefined) return null;
    const event = events[index]!;
    if (!('status' in event)) return null;
    const status: EventStatus = block.is_error ? 'error' : 'ok';
    const detail = (result ?? {}) as { type?: string; originalFile?: string; oldString?: string; newString?: string; content?: string };
    let next: TimelineEvent = { ...event, status };
    if ((event.kind === 'edit' || event.kind === 'write') && status === 'ok') {
      const change: FileChange = event.kind === 'write' && (detail.type === 'create' || detail.originalFile === undefined || detail.originalFile === '') ? 'added' : 'modified';
      next = { ...event, status, change, oldText: event.kind === 'write' ? str(detail.originalFile) : event.oldText };
    }
    events[index] = next;
    return next;
  };

  const push = (line: string): TimelineEvent[] => {
    const record = parseLine(line);
    if (!record || !record.type) return [];
    if (record.sessionId && !meta.id) meta.id = record.sessionId;
    if (record.cwd && !meta.cwd) meta.cwd = record.cwd;
    if (record.slug && !meta.slug) meta.slug = record.slug;
    if (record.version && !meta.version) meta.version = record.version;
    if (record.timestamp) {
      meta.startedAt ??= record.timestamp;
      meta.updatedAt = record.timestamp;
    }
    if (record.type !== 'user' && record.type !== 'assistant') return [];
    const base: Base = { id: record.uuid ?? `${events.length}`, ts: record.timestamp ?? '', sidechain: record.isSidechain === true };
    const content = record.message?.content;
    const changed: TimelineEvent[] = [];
    if (record.type === 'user') {
      if (typeof content === 'string') {
        if (SYSTEM_PROMPT_PREFIX.test(content.trim())) return [];
        const text = clip(content.trim(), MAX_PROMPT);
        if (!base.sidechain && meta.title === null && meta.origin === 'terminal') meta.title = titleFrom(content.trim());
        changed.push(upsert({ ...base, kind: 'prompt', text }));
        return changed;
      }
      if (!Array.isArray(content)) return [];
      for (const block of content as Block[]) {
        if (block.type === 'tool_result') {
          const updated = applyResult(block, record.toolUseResult);
          if (updated) changed.push(updated);
        } else if (block.type === 'text' && typeof block.text === 'string' && !SYSTEM_PROMPT_PREFIX.test(block.text.trim())) {
          if (!base.sidechain && meta.title === null && meta.origin === 'terminal') meta.title = titleFrom(block.text.trim());
          changed.push(upsert({ ...base, kind: 'prompt', text: clip(block.text.trim(), MAX_PROMPT) }));
        }
      }
      return changed;
    }
    if (!Array.isArray(content)) return [];
    (content as Block[]).forEach((block, i) => {
      const id = `${base.id}:${i}`;
      if (block.type === 'text' && block.text?.trim()) changed.push(upsert({ ...base, id, kind: 'text', text: clip(block.text.trim(), MAX_TEXT) }));
      if (block.type === 'tool_use') {
        const event = fromToolUse(block, { ...base, id });
        if (!event) return;
        if (block.id) byToolUse.set(block.id, events.length);
        changed.push(upsert(event));
      }
    });
    return changed;
  };

  return { events, meta, push };
};

/** Files inside the repository touched by successful edits and writes, last change wins. */
export const touchedFiles = (events: TimelineEvent[]): TouchedFile[] => {
  const touched = new Map<string, FileChange>();
  for (const event of events) {
    if ((event.kind !== 'edit' && event.kind !== 'write') || event.status !== 'ok' || !event.path) continue;
    const previous = touched.get(event.path);
    touched.set(event.path, previous === 'added' ? 'added' : event.change);
  }
  return [...touched].map(([path, change]) => ({ path, change }));
};
