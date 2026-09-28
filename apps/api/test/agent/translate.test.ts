import type Anthropic from '@anthropic-ai/sdk';
import { sampleRegistry, type Scene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import type { LlmClient } from '../../src/agent/llm';
import { MAX_TRANSLATE_ATTEMPTS, sameStructure, translateScene, TranslateError } from '../../src/agent/translate';

const base = sampleRegistry['checkout-en']!;
const reply = (input: unknown) =>
  ({ id: 'm', type: 'message', role: 'assistant', model: 'x', stop_reason: 'tool_use', stop_sequence: null, content: [{ type: 'tool_use', id: 't', name: 'emit_scene', input }], usage: { input_tokens: 7, output_tokens: 3 } }) as unknown as Anthropic.Beta.BetaMessage;
const llmReturning = (...outputs: unknown[]): LlmClient & { calls: number } => {
  const client = { model: 'x', calls: 0, async turn() { client.calls++; return reply(outputs.shift()); } };
  return client;
};
const translated = (scene: Scene, language: string): Scene => ({ ...scene, language, title: `${scene.title} (${language})`, nodes: scene.nodes.map((n) => ({ ...n, summary: `[${language}] ${n.summary}` })) });

describe('sameStructure', () => {
  it('accepts text-only changes and reports structural ones', () => {
    expect(sameStructure(base, translated(base, 'es'))).toEqual([]);
    const moved = { ...base, edges: base.edges.map((e, i) => (i === 0 ? { ...e, to: base.nodes[0]!.id } : e)) };
    expect(sameStructure(base, moved)).toEqual([expect.stringMatching(/^edges differ/)]);
    expect(sameStructure(base, { ...base, nodes: base.nodes.slice(1) })).toEqual([expect.stringMatching(/^nodes differ/)]);
  });
});

describe('translateScene', () => {
  it('returns the translated scene and usage', async () => {
    const llm = llmReturning(translated(base, 'es'));
    const result = await translateScene(llm, base, 'es');
    expect(result.scene.language).toBe('es');
    expect(result.usage).toEqual({ input: 7, output: 3 });
  });

  it('retries structural changes and invalid scenes, then gives up', async () => {
    const bad = { ...translated(base, 'es'), nodes: base.nodes.slice(1) };
    const recovering = llmReturning(bad, { id: 'x' }, translated(base, 'es'));
    expect((await translateScene(recovering, base, 'es')).scene.language).toBe('es');
    expect(recovering.calls).toBe(3);
    const hopeless = llmReturning(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => bad));
    await expect(translateScene(hopeless, base, 'es')).rejects.toBeInstanceOf(TranslateError);
  });

  it('rejects a result in the wrong language', async () => {
    const llm = llmReturning(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => translated(base, 'pt')));
    await expect(translateScene(llm, base, 'es')).rejects.toBeInstanceOf(TranslateError);
  });
});
