import { describe, expect, it } from 'vitest';
import { AGENT_MAX_TOKENS, buildTurnParams, FALLBACK_BETA } from '../../src/agent/anthropicLlm';

const input = { system: 'sys', messages: [{ role: 'user' as const, content: 'hi' }], tools: [{ name: 't', description: 'd', input_schema: { type: 'object' as const, properties: {} } }] };

describe('buildTurnParams', () => {
  it('streams with adaptive thinking, caching, eager tool input and server-side fallbacks on Opus 5', () => {
    const params = buildTurnParams('claude-opus-5', input);
    expect(params).toMatchObject({
      model: 'claude-opus-5', max_tokens: AGENT_MAX_TOKENS, system: 'sys', thinking: { type: 'adaptive' }, output_config: { effort: 'high' },
      cache_control: { type: 'ephemeral' }, betas: [FALLBACK_BETA], fallbacks: 'default',
    });
    expect(params.tools).toEqual([{ ...input.tools[0], eager_input_streaming: true }]);
  });

  it('omits fallbacks for models that do not support them', () => {
    const params = buildTurnParams('claude-sonnet-5', input);
    expect(params).not.toHaveProperty('fallbacks');
    expect(params).not.toHaveProperty('betas');
  });
});
