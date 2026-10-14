import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { TouchedFile } from '../observer/parse';
import { clipDiff, MAX_DIFF_BYTES } from './git';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const LIST_LIMIT = 30;
const CACHE_MS = 30_000;
const LIST_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,updatedAt,url,additions,deletions,changedFiles';
const VIEW_FIELDS = `${LIST_FIELDS},body,files`;

export type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number };
export type PullFile = { path: string; additions: number; deletions: number; change: TouchedFile['change'] };
export type PullDetail = { pull: PullSummary & { body: string }; files: PullFile[] };
export type GhError = 'gh_missing' | 'gh_not_logged_in' | 'no_remote' | 'gh_failed';
export class GhFailure extends Error {
  constructor(public readonly code: GhError, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}

type RawPull = { number: number; title: string; author: { login: string }; headRefName: string; baseRefName: string; isDraft: boolean; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number };

const classify = (error: unknown): GhFailure => {
  const e = error as NodeJS.ErrnoException & { stderr?: string };
  if (e.code === 'ENOENT') return new GhFailure('gh_missing');
  const stderr = String(e.stderr ?? e.message ?? '');
  if (/not logged in|auth login|authentication/i.test(stderr)) return new GhFailure('gh_not_logged_in', stderr.trim());
  if (/no git remotes|could not determine|not a git repository|none of the git remotes/i.test(stderr)) return new GhFailure('no_remote', stderr.trim());
  return new GhFailure('gh_failed', stderr.trim().split('\n')[0]);
};

const gh = async (bin: string, cwd: string, args: string[], stdin?: string): Promise<string> => {
  try {
    const child = run(bin, args, { cwd, maxBuffer: MAX_BUFFER, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    if (stdin !== undefined) {
      child.child.stdin?.end(stdin);
    }
    return (await child).stdout;
  } catch (error) {
    throw classify(error);
  }
};

export type ReviewComment = { path: string; line: number; side: 'RIGHT' | 'LEFT'; body: string };
export type ReviewResult = { id: number; url: string };

const summary = (p: RawPull): PullSummary => ({
  number: p.number, title: p.title, author: p.author?.login ?? '', draft: p.isDraft, headRef: p.headRefName, baseRef: p.baseRefName, updatedAt: p.updatedAt, url: p.url,
  additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles,
});

/** Reads added/removed/renamed from the diff headers; anything else in the file list is a modification. */
export const diffStatuses = (diff: string): Map<string, TouchedFile['change']> => {
  const statuses = new Map<string, TouchedFile['change']>();
  const blocks = diff.split(/^diff --git /m).slice(1);
  for (const block of blocks) {
    const header = block.split('\n')[0] ?? '';
    const path = /\sb\/(.+)$/.exec(header)?.[1] ?? header.replace(/^a\/(.+) b\/.+$/, '$1');
    if (/^new file mode/m.test(block)) statuses.set(path, 'added');
    else if (/^deleted file mode/m.test(block)) statuses.set(path, 'removed');
    else if (/^rename from /m.test(block)) {
      const from = /^rename from (.+)$/m.exec(block)?.[1];
      if (from) statuses.set(from, 'removed');
      statuses.set(path, 'added');
    } else statuses.set(path, 'modified');
  }
  return statuses;
};

const cache = new Map<string, { at: number; pulls: PullSummary[] }>();

export const createGh = (bin: string) => ({
  listPulls: async (cwd: string, refresh = false): Promise<PullSummary[]> => {
    const hit = cache.get(cwd);
    if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.pulls;
    const pulls = (JSON.parse(await gh(bin, cwd, ['pr', 'list', '--state', 'open', '--limit', String(LIST_LIMIT), '--json', LIST_FIELDS])) as RawPull[]).map(summary);
    cache.set(cwd, { at: Date.now(), pulls });
    return pulls;
  },
  pullDiff: async (cwd: string, number: number, maxBytes = MAX_DIFF_BYTES): Promise<string> => clipDiff(await gh(bin, cwd, ['pr', 'diff', String(number)]), maxBytes),
  /** Posts one COMMENT review with inline comments through the GitHub REST API (gh resolves {owner}/{repo}). */
  createReview: async (cwd: string, number: number, review: { body: string; comments: ReviewComment[] }): Promise<ReviewResult> => {
    const out = await gh(bin, cwd, ['api', '--method', 'POST', `repos/{owner}/{repo}/pulls/${number}/reviews`, '--input', '-'], JSON.stringify({ event: 'COMMENT', ...review }));
    const parsed = JSON.parse(out) as { id: number; html_url: string };
    return { id: parsed.id, url: parsed.html_url };
  },
  pullDetail: async (cwd: string, number: number): Promise<PullDetail> => {
    const raw = JSON.parse(await gh(bin, cwd, ['pr', 'view', String(number), '--json', VIEW_FIELDS])) as RawPull & { body: string; files: { path: string; additions: number; deletions: number }[] };
    const statuses = diffStatuses(await gh(bin, cwd, ['pr', 'diff', String(number)]));
    return { pull: { ...summary(raw), body: raw.body ?? '' }, files: raw.files.map((f) => ({ ...f, change: statuses.get(f.path) ?? 'modified' })) };
  },
});
export type Gh = ReturnType<typeof createGh>;
