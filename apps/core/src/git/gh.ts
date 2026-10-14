import { execFile } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import type { TouchedFile } from '../observer/parse';
import { clipDiff, MAX_DIFF_BYTES } from './git';

const run = promisify(execFile);
const MAX_BUFFER = 64 * 1024 * 1024;
const LIST_LIMIT = 30;
const CACHE_MS = 30_000;
const LIST_FIELDS = 'number,title,author,headRefName,baseRefName,isDraft,updatedAt,url,additions,deletions,changedFiles,reviewDecision,latestReviews';
const LOGIN_CACHE_MS = 60 * 60_000;
const VIEW_FIELDS = `${LIST_FIELDS},body,files`;

export type ReviewState = { decision: 'approved' | 'changes_requested' | 'pending'; approvedByMe: boolean; approvals: number; changesRequested: number };
export type PullSummary = { number: number; title: string; author: string; draft: boolean; headRef: string; baseRef: string; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number; review: ReviewState };
export type PullFile = { path: string; additions: number; deletions: number; change: TouchedFile['change'] };
export type PullDetail = { pull: PullSummary & { body: string }; files: PullFile[] };
export type GhError = 'gh_missing' | 'gh_not_logged_in' | 'no_remote' | 'gh_failed';
export class GhFailure extends Error {
  constructor(public readonly code: GhError, detail = '') {
    super(`${code}${detail ? `: ${detail}` : ''}`);
  }
}

type RawReview = { author?: { login?: string }; state?: string };
type RawPull = { number: number; title: string; author: { login: string }; headRefName: string; baseRefName: string; isDraft: boolean; updatedAt: string; url: string; additions: number; deletions: number; changedFiles: number; reviewDecision?: string; latestReviews?: RawReview[] };

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
export type GistResult = { id: string; owner: string; url: string; rawUrl: (file: string) => string };
const GIST_URL = /gist\.github\.com\/(?:([^/\s]+)\/)?([0-9a-f]+)/;

/** Review state from the latest review of each reviewer, plus GitHub's own decision when branch protection computes one. */
export const reviewState = (p: Pick<RawPull, 'reviewDecision' | 'latestReviews'>, me: string | null): ReviewState => {
  const latest = p.latestReviews ?? [];
  const approvals = latest.filter((r) => r.state === 'APPROVED').length;
  const changesRequested = latest.filter((r) => r.state === 'CHANGES_REQUESTED').length;
  const decision = p.reviewDecision === 'APPROVED' || (p.reviewDecision !== 'CHANGES_REQUESTED' && approvals > 0 && changesRequested === 0) ? 'approved' : p.reviewDecision === 'CHANGES_REQUESTED' || changesRequested > 0 ? 'changes_requested' : 'pending';
  return { decision, approvedByMe: me !== null && latest.some((r) => r.state === 'APPROVED' && r.author?.login === me), approvals, changesRequested };
};

const summary = (p: RawPull, me: string | null): PullSummary => ({
  number: p.number, title: p.title, author: p.author?.login ?? '', draft: p.isDraft, headRef: p.headRefName, baseRef: p.baseRefName, updatedAt: p.updatedAt, url: p.url,
  additions: p.additions, deletions: p.deletions, changedFiles: p.changedFiles, review: reviewState(p, me),
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
let login: { at: number; value: string | null } | null = null;

const target = (remote?: string | null) => (remote ? ['-R', remote] : []);
const apiBase = (remote?: string | null) => (remote ? `repos/${remote}` : 'repos/{owner}/{repo}');

export const createGh = (bin: string) => {
  const me = async (cwd: string): Promise<string | null> => {
    if (login && Date.now() - login.at < LOGIN_CACHE_MS) return login.value;
    const value = await gh(bin, cwd, ['api', 'user', '--jq', '.login']).then((out) => out.trim() || null).catch(() => null);
    login = { at: Date.now(), value };
    return value;
  };
  return {
  invalidate: (cwd: string) => cache.delete(cwd),
  listPulls: async (cwd: string, refresh = false, remote?: string | null): Promise<PullSummary[]> => {
    const hit = cache.get(cwd);
    if (!refresh && hit && Date.now() - hit.at < CACHE_MS) return hit.pulls;
    const user = await me(cwd);
    const pulls = (JSON.parse(await gh(bin, cwd, ['pr', 'list', ...target(remote), '--state', 'open', '--limit', String(LIST_LIMIT), '--json', LIST_FIELDS])) as RawPull[]).map((p) => summary(p, user));
    cache.set(cwd, { at: Date.now(), pulls });
    return pulls;
  },
  pullDiff: async (cwd: string, number: number, maxBytes = MAX_DIFF_BYTES, remote?: string | null): Promise<string> => clipDiff(await gh(bin, cwd, ['pr', 'diff', String(number), ...target(remote)]), maxBytes),
  /** Posts one COMMENT review with inline comments through the GitHub REST API (gh resolves {owner}/{repo}). */
  createReview: async (cwd: string, number: number, review: { body: string; comments: ReviewComment[] }, remote?: string | null): Promise<ReviewResult> => {
    const out = await gh(bin, cwd, ['api', '--method', 'POST', `${apiBase(remote)}/pulls/${number}/reviews`, '--input', '-'], JSON.stringify({ event: 'COMMENT', ...review }));
    const parsed = JSON.parse(out) as { id: number; html_url: string };
    return { id: parsed.id, url: parsed.html_url };
  },
  /** Publishes text files (SVG, markdown) as one public gist so GitHub can render them inside pull request comments. */
  createGist: async (cwd: string, description: string, files: Record<string, string>): Promise<GistResult> => {
    const dir = await mkdtemp(join(tmpdir(), 'rdi-gist-'));
    try {
      const paths = await Promise.all(Object.entries(files).map(async ([name, content]) => {
        const path = join(dir, name);
        await writeFile(path, content);
        return path;
      }));
      const out = await gh(bin, cwd, ['gist', 'create', '--public', '--desc', description, ...paths]);
      const match = GIST_URL.exec(out);
      if (!match) throw new GhFailure('gh_failed', `unexpected gist output: ${out.trim()}`);
      const id = match[2]!;
      const owner = match[1] ?? (await gh(bin, cwd, ['api', 'user', '--jq', '.login'])).trim();
      return { id, owner, url: `https://gist.github.com/${owner}/${id}`, rawUrl: (file) => `https://gist.githubusercontent.com/${owner}/${id}/raw/${file}` };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  /** Submits an approving (or changes-requested) review with `gh pr review`; returns the review URL from the API. */
  reviewPull: async (cwd: string, number: number, decision: 'approve' | 'request_changes', body: string, remote?: string | null): Promise<ReviewResult> => {
    await gh(bin, cwd, ['pr', 'review', String(number), ...target(remote), decision === 'approve' ? '--approve' : '--request-changes', '--body', body]);
    const reviews = JSON.parse(await gh(bin, cwd, ['api', `${apiBase(remote)}/pulls/${number}/reviews`])) as { id: number; html_url: string; state: string }[];
    const latest = reviews.at(-1);
    return latest ? { id: latest.id, url: latest.html_url } : { id: 0, url: '' };
  },
  /** Clones a GitHub repository into one of our folders so the whole app works on it without the person managing code. */
  cloneRepo: async (cwd: string, fullName: string, into: string): Promise<void> => {
    await gh(bin, cwd, ['repo', 'clone', fullName, into]);
  },
  pullDetail: async (cwd: string, number: number, remote?: string | null): Promise<PullDetail> => {
    const raw = JSON.parse(await gh(bin, cwd, ['pr', 'view', String(number), ...target(remote), '--json', VIEW_FIELDS])) as RawPull & { body: string; files: { path: string; additions: number; deletions: number }[] };
    const statuses = diffStatuses(await gh(bin, cwd, ['pr', 'diff', String(number), ...target(remote)]));
    return { pull: { ...summary(raw, await me(cwd)), body: raw.body ?? '' }, files: raw.files.map((f) => ({ ...f, change: statuses.get(f.path) ?? 'modified' })) };
  },
  };
};
export type Gh = ReturnType<typeof createGh>;
