import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { QueryFn, QueryLike } from '../../src/agent/sdkRunner';

export type Script = (
  | { text: string }
  | { tool: string; input: unknown }
  | { result: 'success' | 'error_max_turns' | 'error_during_execution'; text?: string }
  | { throw: string }
)[];

const USAGE = { input_tokens: 7, output_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 };
let counter = 0;
const id = () => `id${++counter}`;

/** A QueryFn that plays one script per call; tool entries run through the real in-process tools. */
export const scripted = (...scripts: Script[]): QueryFn & { calls: { prompt: string; options: Record<string, unknown> }[] } => {
  const calls: { prompt: string; options: Record<string, unknown> }[] = [];
  const fn = ((params, local) => {
    calls.push({ prompt: params.prompt, options: params.options as Record<string, unknown> });
    const script = scripts.shift() ?? [];
    const session = 'session-1';
    const generator = async function* (): AsyncGenerator<SDKMessage> {
      for (const step of script) {
        if ('throw' in step) throw new Error(step.throw);
        if ('result' in step) {
          const base = { type: 'result', uuid: id(), session_id: session, duration_ms: 1, duration_api_ms: 1, num_turns: 1, total_cost_usd: 0.01, usage: USAGE, modelUsage: {}, permission_denials: [] };
          yield (step.result === 'success'
            ? { ...base, subtype: 'success', is_error: false, result: step.text ?? '', stop_reason: 'end_turn' }
            : { ...base, subtype: step.result, is_error: true, errors: [step.text ?? step.result], stop_reason: null }) as unknown as SDKMessage;
        } else if ('text' in step) {
          yield { type: 'assistant', uuid: id(), session_id: session, parent_tool_use_id: null, message: { id: id(), type: 'message', role: 'assistant', model: 'x', content: [{ type: 'text', text: step.text }], stop_reason: null, stop_sequence: null, usage: USAGE } } as unknown as SDKMessage;
        } else if ('tool' in step) {
          const useId = id();
          yield { type: 'assistant', uuid: id(), session_id: session, parent_tool_use_id: null, message: { id: id(), type: 'message', role: 'assistant', model: 'x', content: [{ type: 'tool_use', id: useId, name: ['emit_scene', 'upsert_solution'].includes(step.tool) ? `mcp__rdi__${step.tool}` : step.tool, input: step.input }], stop_reason: null, stop_sequence: null, usage: USAGE } } as unknown as SDKMessage;
          const builtIn = step.tool.includes('__') || !['emit_scene', 'upsert_solution'].includes(step.tool);
          const outcome = builtIn ? { content: 'ok', isError: false } : await local.call(step.tool, step.input);
          yield { type: 'user', uuid: id(), session_id: session, parent_tool_use_id: null, message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: useId, content: outcome.content, ...(outcome.isError ? { is_error: true } : {}) }] } } as unknown as SDKMessage;
        }
      }
    };
    const stream = generator() as unknown as QueryLike;
    stream.close = () => undefined;
    return stream;
  }) as QueryFn & { calls: typeof calls };
  fn.calls = calls;
  return fn;
};

export const agentConfig = { fake: true, model: null, maxTurns: 16, maxBudgetUsd: null, heartbeatMs: 15_000, claudeExecutable: null };
