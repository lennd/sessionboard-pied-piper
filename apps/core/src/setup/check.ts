import { execFile } from 'node:child_process';
import { createRequire } from 'node:module';
import { promisify } from 'node:util';

const run = promisify(execFile);
const TIMEOUT_MS = 15_000;
const CACHE_MS = 60_000;

export type SetupStatus = {
  claude: { ok: boolean; loggedIn: boolean; email: string | null; method: string | null; detail: string | null };
  gh: { ok: boolean; installed: boolean; loggedIn: boolean; login: string | null; detail: string | null };
  checkedAt: string;
};

/** The Claude Code binary bundled with the Agent SDK for this platform, unless the user points elsewhere. */
export const claudeBinary = (override: string | null): string | null => {
  if (override) return override;
  try {
    return createRequire(import.meta.url).resolve(`@anthropic-ai/claude-agent-sdk-${process.platform}-${process.arch}/claude`);
  } catch {
    return null;
  }
};

const exec = async (bin: string, args: string[]): Promise<{ ok: boolean; out: string; err: string }> => {
  try {
    const { stdout, stderr } = await run(bin, args, { timeout: TIMEOUT_MS, env: { ...process.env, GH_PROMPT_DISABLED: '1', NO_COLOR: '1' } });
    return { ok: true, out: stdout, err: stderr };
  } catch (error) {
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    return { ok: false, out: e.stdout ?? '', err: e.code === 'ENOENT' ? 'ENOENT' : (e.stderr || e.message || '').trim() };
  }
};

const checkClaude = async (bin: string | null): Promise<SetupStatus['claude']> => {
  if (!bin) return { ok: false, loggedIn: false, email: null, method: null, detail: 'claude_binary_missing' };
  const result = await exec(bin, ['auth', 'status', '--json']);
  if (!result.ok && result.err === 'ENOENT') return { ok: false, loggedIn: false, email: null, method: null, detail: 'claude_binary_missing' };
  try {
    const parsed = JSON.parse(result.out) as { loggedIn?: boolean; email?: string; authMethod?: string };
    return { ok: parsed.loggedIn === true, loggedIn: parsed.loggedIn === true, email: parsed.email ?? null, method: parsed.authMethod ?? null, detail: parsed.loggedIn ? null : 'claude_not_logged_in' };
  } catch {
    return { ok: false, loggedIn: false, email: null, method: null, detail: result.err.split('\n')[0] || 'claude_status_unreadable' };
  }
};

const checkGh = async (bin: string): Promise<SetupStatus['gh']> => {
  const version = await exec(bin, ['--version']);
  if (!version.ok) return { ok: false, installed: false, loggedIn: false, login: null, detail: 'gh_missing' };
  const login = await exec(bin, ['api', 'user', '--jq', '.login']);
  if (!login.ok || !login.out.trim()) return { ok: false, installed: true, loggedIn: false, login: null, detail: 'gh_not_logged_in' };
  return { ok: true, installed: true, loggedIn: true, login: login.out.trim(), detail: null };
};

let cache: { at: number; status: SetupStatus } | null = null;

export const checkSetup = async (input: { claudeExecutable: string | null; ghBin: string }, refresh = false): Promise<SetupStatus> => {
  if (!refresh && cache && Date.now() - cache.at < CACHE_MS) return cache.status;
  const [claude, gh] = await Promise.all([checkClaude(claudeBinary(input.claudeExecutable)), checkGh(input.ghBin)]);
  const status: SetupStatus = { claude, gh, checkedAt: new Date().toISOString() };
  cache = { at: Date.now(), status };
  return status;
};

export const resetSetupCache = (): void => {
  cache = null;
};
