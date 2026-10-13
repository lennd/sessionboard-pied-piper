import { sampleRegistry, type Scene } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { MAX_TRANSLATE_ATTEMPTS, sameStructure, translatePrompt, translateScene, TranslateError } from '../../src/agent/translate';
import { agentConfig, scripted, type Script } from './scripted';

const base = sampleRegistry['checkout-en']!;
const translated = (scene: Scene, language: string): Scene => ({ ...scene, language, title: `${scene.title} (${language})`, nodes: scene.nodes.map((n) => ({ ...n, summary: `[${language}] ${n.summary}` })) });
const emitting = (scene: unknown): Script => [{ tool: 'emit_scene', input: scene }, { result: 'success' }];
const run = (fn: ReturnType<typeof scripted>, language = 'es') => translateScene(fn, { cwd: '/tmp', scene: base, language, agent: agentConfig });

describe('sameStructure', () => {
  it('accepts text-only changes and reports structural ones', () => {
    expect(sameStructure(base, translated(base, 'es'))).toEqual([]);
    const moved = { ...base, edges: base.edges.map((e, i) => (i === 0 ? { ...e, to: base.nodes[0]!.id } : e)) };
    expect(sameStructure(base, moved)).toEqual([expect.stringMatching(/^edges differ/)]);
    expect(sameStructure(base, { ...base, nodes: base.nodes.slice(1) })).toEqual([expect.stringMatching(/^nodes differ/)]);
  });
});

describe('translateScene', () => {
  it('returns the translated scene and usage, restricting the agent to emit_scene', async () => {
    const fn = scripted(emitting(translated(base, 'es')));
    const result = await run(fn);
    expect(result.scene.language).toBe('es');
    expect(result.usage).toEqual({ input: 7, output: 3, costUsd: 0.01 });
    expect(fn.calls[0]!.prompt).toBe(translatePrompt(base, 'es'));
    expect(fn.calls[0]!.options.allowedTools).toEqual(['mcp__rdi__emit_scene']);
    expect(fn.calls[0]!.options.maxTurns).toBe(4);
  });

  it('retries structural changes once with the problems in the prompt, then gives up', async () => {
    const bad = { ...translated(base, 'es'), nodes: base.nodes.slice(1) };
    const recovering = scripted(emitting(bad), emitting(translated(base, 'es')));
    expect((await run(recovering)).scene.language).toBe('es');
    expect(recovering.calls).toHaveLength(2);
    expect(recovering.calls[1]!.prompt).toContain('nodes differ from the original');
    const hopeless = scripted(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => emitting(bad)));
    await expect(run(hopeless)).rejects.toBeInstanceOf(TranslateError);
  });

  it('rejects a result in the wrong language and a run that never emits', async () => {
    await expect(run(scripted(...Array.from({ length: MAX_TRANSLATE_ATTEMPTS }, () => emitting(translated(base, 'pt')))))).rejects.toBeInstanceOf(TranslateError);
    await expect(run(scripted([{ text: 'no scene' }, { result: 'success' }], [{ result: 'success' }]))).rejects.toBeInstanceOf(TranslateError);
  });

  it('turns agent errors into TranslateError', async () => {
    await expect(run(scripted([{ result: 'error_during_execution', text: 'overloaded' }]))).rejects.toThrow('llm_error');
  });
});
