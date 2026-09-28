import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { createFakeLlm, TRANSLATE_MARKER } from '../../src/agent/fakeLlm';

type Param = Anthropic.Beta.BetaMessageParam;
const llm = createFakeLlm();
const turn = (messages: Param[]) => llm.turn({ system: 's', messages, tools: [] });
const toolUse = (message: Anthropic.Beta.BetaMessage) => message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use')!;

describe('createFakeLlm', () => {
  it('searches, emits a scene from the results, then answers', async () => {
    const user: Param = { role: 'user', content: [{ type: 'text', text: 'Respond in Spanish (es).' }, { type: 'text', text: 'orders' }] };
    const first = await turn([user]);
    expect(first.stop_reason).toBe('tool_use');
    expect(toolUse(first)).toMatchObject({ name: 'search_graph', input: { query: 'orders' } });
    const results = [{ id: 'queue:o:orders', label: 'Queue', name: 'orders', summary: 'q' }, { id: 'table:o:orders', label: 'Table', name: 'orders', summary: 't' }];
    const second = await turn([user, { role: 'assistant', content: first.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse(first).id, content: JSON.stringify(results) }] }]);
    const scene = toolUse(second).input as { language: string; nodes: { role: string }[]; steps: unknown[] };
    expect(toolUse(second).name).toBe('emit_scene');
    expect(scene.language).toBe('es');
    expect(scene.nodes.map((n) => n.role)).toEqual(['channel', 'storage']);
    expect(scene.steps).toHaveLength(1);
    const third = await turn([user, { role: 'assistant', content: second.content }, { role: 'user', content: [{ type: 'tool_result', tool_use_id: toolUse(second).id, content: 'Scene "x" rendered' }] }]);
    expect(third.stop_reason).toBe('end_turn');
    expect(third.content[0]).toMatchObject({ type: 'text' });
  });

  it('translates by echoing the scene with the new language', async () => {
    const scene = { id: 's', title: 'T', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'compute', kind: 'k', summary: 's' }] };
    const message = await turn([{ role: 'user', content: `${TRANSLATE_MARKER} pt\n\n${JSON.stringify(scene)}` }]);
    expect(toolUse(message)).toMatchObject({ name: 'emit_scene', input: { ...scene, language: 'pt' } });
  });
});
