import Anthropic from '@anthropic-ai/sdk';
import type { LlmClient, LlmTurnInput } from './llm';

export const AGENT_MAX_TOKENS = 32_000;
export const FALLBACK_BETA = 'server-side-fallback-2026-07-01';
export const FALLBACK_MODELS = new Set(['claude-opus-5', 'claude-opus-5-5', 'claude-fable-5-1']);

export const buildTurnParams = (model: string, input: LlmTurnInput) => ({
  model,
  max_tokens: AGENT_MAX_TOKENS,
  system: input.system,
  messages: input.messages,
  tools: input.tools.map((tool) => ({ ...tool, eager_input_streaming: true })),
  thinking: { type: 'adaptive' as const },
  output_config: { effort: 'high' as const },
  cache_control: { type: 'ephemeral' as const },
  ...(FALLBACK_MODELS.has(model) ? { betas: [FALLBACK_BETA], fallbacks: 'default' as const } : {}),
});

export const createAnthropicLlm = (model: string, client: Anthropic = new Anthropic()): LlmClient => ({
  model,
  async turn(input) {
    const stream = client.beta.messages.stream(buildTurnParams(model, input), { signal: input.signal });
    if (input.onText) stream.on('text', input.onText);
    return stream.finalMessage();
  },
});
