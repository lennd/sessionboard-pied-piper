import Anthropic from '@anthropic-ai/sdk';
import type { Scene } from '@rdi/scene';
import type { LlmClient } from './llm';
import { executeTool, toolDefinitions, type ToolContext } from './tools';

type Param = Anthropic.Beta.BetaMessageParam;
type ToolUse = Anthropic.Beta.BetaToolUseBlock;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; summary: string }
  | { type: 'scene'; scene: Scene }
  | { type: 'solution'; id: string; n: number; title: string }
  | { type: 'error'; code: 'refusal' | 'max_tokens' | 'max_iterations' | 'llm_error' | 'aborted'; message: string };

type ErrorCode = Extract<AgentEvent, { type: 'error' }>['code'];
export type AgentResult = { appended: Param[]; scenes: Scene[]; usage: { input: number; output: number }; stop: 'end_turn' | 'error'; errorCode?: ErrorCode };

export const MAX_ITERATIONS = 10;
export const MAX_JSON_RETRIES = 2;
export const MAX_INVALID_SCENES = 3;
export const STOP_EMITTING = 'Do not call emit_scene again in this answer; explain in text instead.';

export const runAgent = async (input: {
  llm: LlmClient;
  system: string;
  tools?: Anthropic.Beta.BetaTool[];
  history: Param[];
  user: Param;
  ctx: ToolContext;
  emit: (event: AgentEvent) => void | Promise<void>;
  signal?: AbortSignal;
  usage?: { input: number; output: number };
}): Promise<AgentResult> => {
  const appended: Param[] = [];
  const scenes: Scene[] = [];
  const usage = input.usage ?? { input: 0, output: 0 };
  let invalidScenes = 0;
  let jsonRetries = 0;
  const fail = async (code: ErrorCode, message: string): Promise<AgentResult> => {
    await input.emit({ type: 'error', code, message });
    return { appended, scenes, usage, stop: 'error', errorCode: code };
  };

  for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
    const textEmits: (void | Promise<void>)[] = [];
    let message: Anthropic.Beta.BetaMessage;
    try {
      message = await input.llm.turn({
        system: input.system,
        messages: [...input.history, input.user, ...appended],
        tools: input.tools ?? toolDefinitions,
        onText: (delta) => {
          if (delta) textEmits.push(input.emit({ type: 'text', delta }));
        },
        signal: input.signal,
      });
      jsonRetries = 0;
    } catch (error) {
      if (input.signal?.aborted) return fail('aborted', 'The request was cancelled.');
      if (error instanceof Anthropic.APIError) return fail('llm_error', error.message);
      if (jsonRetries++ < MAX_JSON_RETRIES) {
        iteration--;
        continue;
      }
      return fail('llm_error', error instanceof Error ? error.message : String(error));
    } finally {
      await Promise.all(textEmits.splice(0));
    }

    const u = message.usage;
    usage.input += u.input_tokens + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0);
    usage.output += u.output_tokens;

    if (message.stop_reason === 'refusal') return fail('refusal', 'The model declined to answer this request.');
    const toolUses = message.content.filter((b): b is ToolUse => b.type === 'tool_use');
    if (message.stop_reason === 'max_tokens') return fail('max_tokens', 'The answer was too long and was cut off.');
    if (message.stop_reason === 'pause_turn') {
      appended.push({ role: 'assistant', content: message.content });
      continue;
    }
    if (toolUses.length === 0) {
      appended.push({ role: 'assistant', content: message.content });
      return { appended, scenes, usage, stop: 'end_turn' };
    }

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      await input.emit({ type: 'tool', name: use.name, status: 'running', summary: use.name });
      const outcome = await executeTool(use.name, use.input, input.ctx);
      let content = outcome.content;
      if (use.name === 'emit_scene' && outcome.isError && ++invalidScenes >= MAX_INVALID_SCENES) content = `${content}\n${STOP_EMITTING}`;
      await input.emit({ type: 'tool', name: use.name, status: outcome.isError ? 'error' : 'done', summary: outcome.summary });
      if (outcome.scene) {
        scenes.push(outcome.scene);
        await input.emit({ type: 'scene', scene: outcome.scene });
      }
      if (outcome.solution) await input.emit({ type: 'solution', ...outcome.solution });
      results.push({ type: 'tool_result', tool_use_id: use.id, content, ...(outcome.isError ? { is_error: true } : {}) });
    }
    appended.push({ role: 'assistant', content: message.content }, { role: 'user', content: results });
  }
  return fail('max_iterations', 'The agent needed too many steps to answer.');
};
