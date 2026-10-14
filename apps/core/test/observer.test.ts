import { appendFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createSessionParser, relativeTo, touchedFiles } from '../src/observer/parse';
import { listSessions, projectDirFor, readSession, tailSession } from '../src/observer/transcripts';

const REPO = '/work/repo';
const line = (o: unknown) => JSON.stringify(o);
const user = (content: unknown, extra: Record<string, unknown> = {}) => line({ type: 'user', uuid: `u${Math.random()}`, timestamp: '2026-10-13T10:00:00Z', cwd: REPO, sessionId: 's1', version: '2.1.296', message: { role: 'user', content }, ...extra });
const assistant = (blocks: unknown[], extra: Record<string, unknown> = {}) => line({ type: 'assistant', uuid: 'a1', timestamp: '2026-10-13T10:00:01Z', cwd: REPO, sessionId: 's1', slug: 'fix-login', message: { role: 'assistant', content: blocks }, ...extra });
const toolUse = (id: string, name: string, input: unknown) => ({ type: 'tool_use', id, name, input });
const result = (id: string, content: string, extra: Record<string, unknown> = {}, toolUseResult?: unknown) => user([{ type: 'tool_result', tool_use_id: id, content, ...extra }], { toolUseResult });

export const transcript = [
  line({ type: 'file-history-snapshot', messageId: 'x', snapshot: {} }),
  user('<command-name>/clear</command-name>'),
  user('Fix the login bug\nplease'),
  assistant([{ type: 'text', text: 'Looking at it.' }]),
  assistant([toolUse('t1', 'Grep', { pattern: 'login' })]),
  result('t1', 'src/auth.ts:3'),
  assistant([toolUse('t2', 'Edit', { file_path: `${REPO}/src/auth.ts`, old_string: 'a', new_string: 'b' })]),
  result('t2', 'ok', {}, { filePath: `${REPO}/src/auth.ts`, originalFile: 'a', structuredPatch: [] }),
  assistant([toolUse('t3', 'Write', { file_path: `${REPO}/src/new.ts`, content: 'x' })]),
  result('t3', 'created', {}, { type: 'create', filePath: `${REPO}/src/new.ts`, content: 'x' }),
  assistant([toolUse('t4', 'Write', { file_path: '/elsewhere/note.md', content: 'y' })]),
  result('t4', 'ok', {}, { type: 'update', originalFile: 'old' }),
  assistant([toolUse('t5', 'Bash', { command: 'npm test && git commit -m "fix"', description: 'Test and commit' })]),
  result('t5', 'boom', { is_error: true }),
  assistant([toolUse('t6', 'Agent', { description: 'Explore auth', prompt: 'x' })]),
  line({ type: 'user', uuid: 'side', isSidechain: true, timestamp: '2026-10-13T10:00:02Z', sessionId: 's1', message: { role: 'user', content: 'subagent prompt' } }),
  result('t6', 'done'),
  assistant([toolUse('t7', 'Edit', { file_path: `${REPO}/src/auth.ts`, old_string: 'b', new_string: 'c' })]),
  'not json',
];

describe('createSessionParser', () => {
  it('turns transcript lines into timeline events with statuses, paths and metadata', () => {
    const parser = createSessionParser(REPO);
    for (const l of transcript) parser.push(l);
    expect(parser.meta).toEqual({ id: 's1', title: 'Fix the login bug', slug: 'fix-login', cwd: REPO, startedAt: '2026-10-13T10:00:00Z', updatedAt: '2026-10-13T10:00:01Z', version: '2.1.296', origin: 'terminal', kind: null });
    const kinds = parser.events.map((e) => `${e.kind}${'status' in e ? `:${e.status}` : ''}${e.sidechain ? '!' : ''}`);
    expect(kinds).toEqual(['prompt', 'text', 'read:ok', 'edit:ok', 'write:ok', 'write:ok', 'bash:error', 'subagent:ok', 'prompt!', 'edit:pending']);
    expect(parser.events[0]).toMatchObject({ kind: 'prompt', text: 'Fix the login bug\nplease' });
    expect(parser.events[3]).toMatchObject({ kind: 'edit', file: `${REPO}/src/auth.ts`, path: 'src/auth.ts', change: 'modified', oldText: 'a', newText: 'b' });
    expect(parser.events[4]).toMatchObject({ kind: 'write', path: 'src/new.ts', change: 'added', oldText: '' });
    expect(parser.events[5]).toMatchObject({ kind: 'write', path: null, change: 'modified', oldText: 'old' });
    expect(parser.events[6]).toMatchObject({ kind: 'bash', git: 'commit', description: 'Test and commit' });
    expect(parser.events[7]).toMatchObject({ kind: 'subagent', description: 'Explore auth' });
    expect(touchedFiles(parser.events)).toEqual([{ path: 'src/auth.ts', change: 'modified' }, { path: 'src/new.ts', change: 'added' }]);
  });

  it('recognises sessions started by the app and shortens read targets inside the repository', () => {
    const parser = createSessionParser(REPO);
    parser.push(user('[rdi:explain]\nRespond in English.\nExplain the impact…'));
    parser.push(assistant([toolUse('t1', 'Read', { file_path: `${REPO}/src/auth.ts` })]));
    expect(parser.meta).toMatchObject({ origin: 'app', kind: 'explain', title: null });
    expect(parser.events[1]).toMatchObject({ kind: 'read', target: 'src/auth.ts' });
  });

  it('reports only the events changed by each line', () => {
    const parser = createSessionParser(REPO);
    expect(parser.push(assistant([toolUse('t1', 'Edit', { file_path: 'src/a.ts', old_string: '', new_string: 'x' })]))).toHaveLength(1);
    expect(parser.push(result('t1', 'ok'))).toEqual([expect.objectContaining({ kind: 'edit', status: 'ok', path: 'src/a.ts' })]);
    expect(parser.push(result('zz', 'ok'))).toEqual([]);
    expect(relativeTo(REPO, `${REPO}/x/y.ts`)).toBe('x/y.ts');
    expect(relativeTo(REPO, '/other/y.ts')).toBeNull();
  });
});

describe('transcripts on disk', () => {
  let claudeHome: string;
  let repo: string;
  beforeEach(async () => {
    claudeHome = await mkdtemp(join(tmpdir(), 'rdi-claude-'));
    repo = await mkdtemp(join(tmpdir(), 'rdi-repo-'));
  });
  afterEach(async () => {
    await rm(claudeHome, { recursive: true, force: true });
    await rm(repo, { recursive: true, force: true });
  });

  it('maps a repository path to its Claude project directory', () => {
    expect(projectDirFor('/home/me/.claude', '/Users/me/.claude/worktrees/x_y')).toBe('/home/me/.claude/projects/-Users-me--claude-worktrees-x-y');
  });

  it('lists, reads and tails sessions of a repository', async () => {
    const dir = projectDirFor(claudeHome, repo);
    await mkdir(dir, { recursive: true });
    const lines = transcript.map((l) => l.replaceAll(REPO, repo));
    await writeFile(join(dir, 'aaa.jsonl'), `${lines.slice(0, 5).join('\n')}\n`);
    await writeFile(join(dir, 'bbb.jsonl'), `${user('Second session').replaceAll(REPO, repo)}\n`);
    await writeFile(join(dir, 'notes.txt'), 'ignored');
    const sessions = await listSessions(claudeHome, repo);
    expect(sessions.map((s) => [s.id, s.title])).toEqual(expect.arrayContaining([['aaa', 'Fix the login bug'], ['bbb', 'Second session']]));
    expect(await listSessions(claudeHome, '/nowhere')).toEqual([]);
    const read = await readSession(claudeHome, repo, 'aaa');
    expect(read!.events).toHaveLength(3);
    expect(await readSession(claudeHome, repo, '../etc')).toBeNull();
    expect(await readSession(claudeHome, repo, 'zzz')).toBeNull();
    const seen: string[] = [];
    const stop = tailSession(claudeHome, repo, 'aaa', read!.offset, (l) => seen.push(l));
    await appendFile(join(dir, 'aaa.jsonl'), `${lines[5]}\n${lines[6]!.slice(0, 10)}`);
    await new Promise((r) => setTimeout(r, 1300));
    await appendFile(join(dir, 'aaa.jsonl'), `${lines[6]!.slice(10)}\n`);
    await new Promise((r) => setTimeout(r, 1300));
    stop();
    expect(seen).toEqual([lines[5], lines[6]]);
  });
});
