import { createSdkMcpServer, query, tool, type CanUseTool, type Options, type SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { Scene } from '@rdi/scene';
import { isAbsolute, relative, sep } from 'node:path';
import type { Config } from '../config';
import { SYSTEM_PROMPT } from './prompt';
import { executeTool, MCP_SERVER_NAME, mcpToolName, TOOL_DESCRIPTIONS, TOOL_NAMES, TOOL_SHAPES, type ToolContext, type ToolOutcome } from './tools';

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; scene: Scene }
  | { type: 'solution'; id: string; n: number; title: string }
  | { type: 'error'; code: 'refusal' | 'max_tokens' | 'max_iterations' | 'llm_error' | 'aborted' | 'budget'; message: string };

export type ErrorCode = Extract<AgentEvent, { type: 'error' }>['code'];
export type RunUsage = { input: number; output: number; costUsd: number };
export type RunResult = { sessionId: string | null; scenes: Scene[]; text: string; usage: RunUsage; stop: 'end_turn' | 'error'; errorCode?: ErrorCode };
export type RunMode = 'analyze' | 'plan' | 'map' | 'translate' | 'run';

export type QueryLike = AsyncIterable<SDKMessage> & { interrupt?: () => Promise<unknown>; close?: () => void };
/** What the runner needs from the SDK; the fake implementation uses `local` to call the in-process tools. */
export type LocalTools = { call(name: string, input: unknown): Promise<ToolOutcome> };
export type QueryFn = (params: { prompt: string; options: Options }, local: LocalTools) => QueryLike;

export const createSdkQuery = (): QueryFn => (params) => query(params);

const READ_ONLY_TOOLS = ['Read', 'Grep', 'Glob', 'Bash(git log:*)', 'Bash(git diff:*)', 'Bash(git show:*)', 'Bash(git status:*)', 'Bash(git blame:*)', 'Bash(ls:*)', 'Bash(wc:*)'];
const EDIT_TOOLS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit'];
const WRITE_TOOLS = [...EDIT_TOOLS, 'WebFetch', 'WebSearch', 'Agent', 'Task', 'KillShell'];
const RUN_DISALLOWED = ['WebFetch', 'WebSearch'];
const RUN_MAX_TURNS = 200;
const TURNS_BY_MODE: Record<RunMode, number | null> = { analyze: null, plan: null, map: null, translate: 4, run: RUN_MAX_TURNS };
const MAX_SUMMARY = 80;
const WRAP_UP_NOTE = 'The agent needed too many steps to answer.';

const clip = (text: string) => (text.length <= MAX_SUMMARY ? text : `${text.slice(0, MAX_SUMMARY - 1)}…`);

/** A one-line description of a built-in tool call for the activity feed. */
export const toolSummary = (name: string, input: unknown): string => {
  const i = (input ?? {}) as Record<string, unknown>;
  const first = [i.file_path, i.pattern, i.command, i.path, i.query].find((v) => typeof v === 'string') as string | undefined;
  return clip(first ? `${name} ${first}` : name);
};

/** Rewrites absolute code paths under the repository as repository-relative ones, which is what the change overlay matches on. */
export const relativizeScene = (scene: Scene, cwd: string): Scene => ({
  ...scene,
  nodes: scene.nodes.map((n) => {
    if (!n.code || !isAbsolute(n.code.path)) return n;
    const rel = relative(cwd, n.code.path);
    return rel && !rel.startsWith('..') && !isAbsolute(rel) ? { ...n, code: { ...n.code, path: rel.split(sep).join('/') } } : n;
  }),
});

const toCallResult = (outcome: ToolOutcome) => ({ content: [{ type: 'text' as const, text: outcome.content }], ...(outcome.isError ? { isError: true } : {}) });

export type BuildInput = { cwd: string; mode: RunMode; resume?: string | null; agent: Config['agent']; abortController: AbortController; local: LocalTools; canUseTool?: CanUseTool; mcpHttpUrl?: string };

/** Run mode implements a Solution: edits are pre-approved, every other tool goes through `canUseTool`, and the Solutions MCP is reached over HTTP. */
export const buildOptions = (input: BuildInput): Options => {
  const tools = TOOL_NAMES.map((name) => tool(name, TOOL_DESCRIPTIONS[name], TOOL_SHAPES[name], async (args) => toCallResult(await input.local.call(name, args)), { alwaysLoad: true }));
  const run = input.mode === 'run';
  const allowed = input.mode === 'translate' ? [mcpToolName('emit_scene')] : run ? [...READ_ONLY_TOOLS, ...EDIT_TOOLS, `mcp__${MCP_SERVER_NAME}__*`] : [...READ_ONLY_TOOLS, ...TOOL_NAMES.map(mcpToolName)];
  const mcpServers: Options['mcpServers'] = run && input.mcpHttpUrl ? { [MCP_SERVER_NAME]: { type: 'http', url: input.mcpHttpUrl } } : { [MCP_SERVER_NAME]: createSdkMcpServer({ name: MCP_SERVER_NAME, tools }) };
  return {
    cwd: input.cwd,
    abortController: input.abortController,
    permissionMode: run ? 'default' : 'dontAsk',
    allowedTools: allowed,
    disallowedTools: run ? RUN_DISALLOWED : WRITE_TOOLS,
    ...(run && input.canUseTool ? { canUseTool: input.canUseTool } : {}),
    mcpServers,
    systemPrompt: { type: 'preset', preset: 'claude_code', append: SYSTEM_PROMPT },
    maxTurns: TURNS_BY_MODE[input.mode] ?? input.agent.maxTurns,
    ...(input.agent.maxBudgetUsd === null ? {} : { maxBudgetUsd: input.agent.maxBudgetUsd }),
    ...(input.agent.model ? { model: input.agent.model } : {}),
    ...(input.agent.claudeExecutable ? { pathToClaudeCodeExecutable: input.agent.claudeExecutable } : {}),
    ...(input.resume ? { resume: input.resume } : {}),
  };
};

type Block = { type: string; text?: string; id?: string; name?: string; input?: unknown; tool_use_id?: string; is_error?: boolean };
const blocksOf = (content: unknown): Block[] => (Array.isArray(content) ? (content as Block[]) : typeof content === 'string' ? [{ type: 'text', text: content }] : []);

const ERROR_BY_SUBTYPE: Record<string, ErrorCode> = { error_max_turns: 'max_iterations', error_max_budget_usd: 'budget', error_during_execution: 'llm_error', error_max_structured_output_retries: 'llm_error' };

export const runAgent = async (
  queryFn: QueryFn,
  input: { cwd: string; prompt: string; mode: RunMode; resume?: string | null; signal?: AbortSignal; agent: Config['agent']; ctx: ToolContext; emit: (event: AgentEvent) => void | Promise<void>; canUseTool?: CanUseTool; mcpHttpUrl?: string },
): Promise<RunResult> => {
  const scenes: Scene[] = [];
  const usage: RunUsage = { input: 0, output: 0, costUsd: 0 };
  const toolNames = new Map<string, string>();
  const texts: string[] = [];
  let sessionId: string | null = null;
  const local: LocalTools = {
    call: async (name, args) => {
      const raw = await executeTool(name, args, input.ctx);
      const outcome = raw.scene ? { ...raw, scene: relativizeScene(raw.scene, input.cwd) } : raw;
      if (outcome.scene) {
        scenes.push(outcome.scene);
        await input.emit({ type: 'scene', scene: outcome.scene });
      }
      if (outcome.solution) await input.emit({ type: 'solution', ...outcome.solution });
      return outcome;
    },
  };
  const abortController = new AbortController();
  const onAbort = () => abortController.abort();
  input.signal?.addEventListener('abort', onAbort, { once: true });
  const fail = async (code: ErrorCode, message: string): Promise<RunResult> => {
    await input.emit({ type: 'error', code, message });
    return { sessionId, scenes, text: texts.join(''), usage, stop: 'error', errorCode: code };
  };

  const options = buildOptions({ cwd: input.cwd, mode: input.mode, resume: input.resume, agent: input.agent, abortController, local, canUseTool: input.canUseTool, mcpHttpUrl: input.mcpHttpUrl });
  let stream: QueryLike;
  try {
    stream = queryFn({ prompt: input.prompt, options }, local);
  } catch (error) {
    input.signal?.removeEventListener('abort', onAbort);
    return fail('llm_error', error instanceof Error ? error.message : String(error));
  }
  const aborted = new Promise<never>((_resolve, reject) => {
    if (abortController.signal.aborted) reject(new Error('aborted'));
    abortController.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
  });
  aborted.catch(() => undefined);
  const iterator = stream[Symbol.asyncIterator]();
  try {
    for (;;) {
      const step = await Promise.race([iterator.next(), aborted]);
      if (step.done) break;
      const message = step.value;
      sessionId = (message as { session_id?: string }).session_id ?? sessionId;
      if (message.type === 'assistant') {
        for (const block of blocksOf(message.message.content)) {
          if (block.type === 'text' && block.text) {
            texts.push(block.text);
            await input.emit({ type: 'text', delta: block.text });
          }
          if (block.type === 'tool_use' && block.id && block.name) {
            toolNames.set(block.id, block.name);
            await input.emit({ type: 'tool', name: block.name, status: 'running', summary: toolSummary(block.name, block.input) });
          }
        }
      } else if (message.type === 'user' && !('isReplay' in message && message.isReplay)) {
        for (const block of blocksOf(message.message.content)) {
          if (block.type !== 'tool_result' || !block.tool_use_id) continue;
          const name = toolNames.get(block.tool_use_id) ?? 'tool';
          await input.emit({ type: 'tool', name, status: block.is_error ? 'error' : 'done', summary: name });
        }
      } else if (message.type === 'result') {
        usage.input += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
        usage.output += message.usage.output_tokens;
        usage.costUsd += message.total_cost_usd;
        if (message.subtype !== 'success') {
          const code = ERROR_BY_SUBTYPE[message.subtype] ?? 'llm_error';
          const detail = 'errors' in message && message.errors.length > 0 ? message.errors.join('; ') : WRAP_UP_NOTE;
          return fail(code, code === 'max_iterations' ? WRAP_UP_NOTE : detail);
        }
        if (message.is_error) return fail('llm_error', message.result);
      }
    }
  } catch (error) {
    if (input.signal?.aborted || abortController.signal.aborted) return fail('aborted', 'The request was cancelled.');
    return fail('llm_error', error instanceof Error ? error.message : String(error));
  } finally {
    input.signal?.removeEventListener('abort', onAbort);
    if (abortController.signal.aborted) void stream!.interrupt?.().catch(() => undefined);
    stream!.close?.();
  }
  if (input.signal?.aborted) return fail('aborted', 'The request was cancelled.');
  return { sessionId, scenes, text: texts.join(''), usage, stop: 'end_turn' };
};
