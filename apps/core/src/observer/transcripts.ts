import { watch, type FSWatcher } from 'node:fs';
import { open, readdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { createSessionParser, type SessionMeta, type TimelineEvent } from './parse';

export type SessionSummary = SessionMeta & { id: string; file: string; size: number; updatedAt: string };

const TRANSCRIPT_EXT = '.jsonl';
const HEAD_BYTES = 256 * 1024;
const POLL_MS = 1000;

/** Claude Code stores transcripts under ~/.claude/projects/<cwd with every non-alphanumeric character replaced by "-">. */
export const projectDirFor = (claudeHome: string, cwd: string): string => join(claudeHome, 'projects', cwd.replace(/[^A-Za-z0-9]/g, '-'));

const sessionFile = (claudeHome: string, cwd: string, sessionId: string) => join(projectDirFor(claudeHome, cwd), `${sessionId}${TRANSCRIPT_EXT}`);

const readHead = async (file: string): Promise<string> => {
  const handle = await open(file, 'r');
  try {
    const buffer = Buffer.alloc(HEAD_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
    return buffer.toString('utf8', 0, bytesRead);
  } finally {
    await handle.close();
  }
};

export const listSessions = async (claudeHome: string, repoPath: string): Promise<SessionSummary[]> => {
  const dir = projectDirFor(claudeHome, repoPath);
  let names: string[];
  try {
    names = (await readdir(dir)).filter((n) => n.endsWith(TRANSCRIPT_EXT));
  } catch {
    return [];
  }
  const sessions = await Promise.all(
    names.map(async (name) => {
      const file = join(dir, name);
      const info = await stat(file);
      const parser = createSessionParser(repoPath);
      for (const line of (await readHead(file)).split('\n')) parser.push(line);
      const id = name.slice(0, -TRANSCRIPT_EXT.length);
      return { ...parser.meta, id, file, size: info.size, updatedAt: info.mtime.toISOString() };
    }),
  );
  return sessions.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

const isSessionId = (value: string) => /^[A-Za-z0-9-]+$/.test(value);

export const readSession = async (claudeHome: string, repoPath: string, sessionId: string): Promise<{ meta: SessionMeta; events: TimelineEvent[]; offset: number } | null> => {
  if (!isSessionId(sessionId)) return null;
  const file = sessionFile(claudeHome, repoPath, sessionId);
  let content: string;
  try {
    content = await (await open(file, 'r')).readFile('utf8');
  } catch {
    return null;
  }
  const parser = createSessionParser(repoPath);
  const lastBreak = content.lastIndexOf('\n');
  const complete = lastBreak === -1 ? '' : content.slice(0, lastBreak + 1);
  for (const line of complete.split('\n')) parser.push(line);
  return { meta: { ...parser.meta, id: sessionId }, events: parser.events, offset: Buffer.byteLength(complete) };
};

/** Follows a transcript from `offset`, pushing every complete new line into `onLine`. Falls back to polling when fs.watch misses events. */
export const tailSession = (claudeHome: string, repoPath: string, sessionId: string, offset: number, onLine: (line: string) => void): (() => void) => {
  const file = sessionFile(claudeHome, repoPath, sessionId);
  let position = offset;
  let rest = '';
  let reading = false;
  let pendingRead = false;
  const readMore = async () => {
    if (reading) {
      pendingRead = true;
      return;
    }
    reading = true;
    try {
      const info = await stat(file).catch(() => null);
      if (info && info.size > position) {
        const handle = await open(file, 'r');
        try {
          const buffer = Buffer.alloc(info.size - position);
          const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
          position += bytesRead;
          const chunk = rest + buffer.toString('utf8', 0, bytesRead);
          const lines = chunk.split('\n');
          rest = lines.pop() ?? '';
          for (const line of lines) if (line.trim()) onLine(line);
        } finally {
          await handle.close();
        }
      }
    } finally {
      reading = false;
      if (pendingRead) {
        pendingRead = false;
        void readMore();
      }
    }
  };
  let watcher: FSWatcher | null = null;
  try {
    watcher = watch(file, () => void readMore());
  } catch {
    watcher = null;
  }
  const timer = setInterval(() => void readMore(), POLL_MS);
  void readMore();
  return () => {
    clearInterval(timer);
    watcher?.close();
  };
};
