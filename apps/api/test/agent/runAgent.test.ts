import Anthropic from '@anthropic-ai/sdk';
import { sampleRegistry } from '@rdi/scene';
import { describe, expect, it, vi } from 'vitest';
import type { LlmClient, LlmTurnInput } from '../../src/agent/llm';
import { MAX_INVALID_SCENES, MAX_ITERATIONS, runAgent, STOP_EMITTING, type AgentEvent } from '../../src/agent/runAgent';
import type { ToolContext } from '../../src/agent/tools';

type Message = Anthropic.Beta.BetaMessage;
const usage = { input_tokens: 10, output_tokens: 5, cache_creation_input_tokens: 3, cache_read_input_tokens: 2 };
const msg = (content: unknown[], stop_reason: string): Message => ({ id: 'm', type: 'message', role: 'assistant', model: 'x', content, stop_reason, stop_sequence: null, usage }) as unknown as Message;
const textMsg = (text: string) => msg([{ type: 'text', text }], 'end_turn');
const toolMsg = (...uses: { id: string; name: string; input: unknown }[]) => msg(uses.map((u) => ({ type: 'tool_use', ...u })), 'tool_use');

const scripted = (steps: (Message | Error | ((input: LlmTurnInput) => Message))[]) => {
  const calls: LlmTurnInput[] = [];
  const llm: LlmClient = {
    model: 'scripted',
    async turn(input) {
      calls.push({ ...input, messages: [...input.messages] });
      const step = steps.shift();
      if (!step) throw new Error('script exhausted');
      if (step instanceof Error) throw step;
      const message = typeof step === 'function' ? step(input) : step;
      for (const b of message.content) if (b.type === 'text') input.onText?.(b.text);
      return message;
    },
  };
  return { llm, calls };
};

const ctx: ToolContext = {
  loadGraph: async () => ({ nodes: [{ id: 'queue:o:orders', label: 'Queue', name: 'orders', summary: 'Orders queue', repoId: null, props: {} }], edges: [] }),
  readSource: async () => null,
  prFiles: async () => null,
};
const user = { role: 'user' as const, content: 'How do orders flow?' };
const collect = () => {
  const events: AgentEvent[] = [];
  return { events, emit: (e: AgentEvent) => { events.push(e); } };
};
const validScene = sampleRegistry['iot-telemetry']!;
const invalidScene = { id: 'x', title: 'X', language: 'en', nodes: [] };

describe('runAgent', () => {
  it('streams a text-only answer', async () => {
    const { llm, calls } = scripted([textMsg('Orders go through a queue.')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 'sys', history: [], user, ctx, emit });
    expect(events).toEqual([{ type: 'text', delta: 'Orders go through a queue.' }]);
    expect(result).toMatchObject({ stop: 'end_turn', scenes: [], usage: { input: 15, output: 5 } });
    expect(result.appended).toEqual([{ role: 'assistant', content: [{ type: 'text', text: 'Orders go through a queue.' }] }]);
    expect(calls[0]!.messages).toEqual([user]);
  });

  it('emits text deltas while the model is still generating', async () => {
    const seen: number[] = [];
    const { events, emit } = collect();
    const { llm } = scripted([(input) => {
      input.onText?.('Hel');
      seen.push(events.length);
      input.onText?.('lo');
      seen.push(events.length);
      return msg([{ type: 'text', text: '' }], 'end_turn');
    }]);
    await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(seen).toEqual([1, 2]);
    expect(events).toEqual([{ type: 'text', delta: 'Hel' }, { type: 'text', delta: 'lo' }]);
  });

  it('runs tools, emits the scene and keeps complete pairs', async () => {
    const { llm, calls } = scripted([
      toolMsg({ id: 't1', name: 'search_graph', input: { query: 'orders' } }),
      toolMsg({ id: 't2', name: 'emit_scene', input: validScene }),
      textMsg('Done.'),
    ]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 'sys', history: [], user, ctx, emit });
    expect(events.map((e) => (e.type === 'tool' ? `${e.name}:${e.status}` : e.type))).toEqual(['search_graph:running', 'search_graph:done', 'emit_scene:running', 'emit_scene:done', 'scene', 'text']);
    expect(result.scenes.map((s) => s.id)).toEqual(['iot-telemetry']);
    expect(result.appended.map((m) => m.role)).toEqual(['assistant', 'user', 'assistant', 'user', 'assistant']);
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0]).toMatchObject({ type: 'tool_result', tool_use_id: 't1' });
    expect(JSON.parse(results[0]!.content as string)[0]).toMatchObject({ id: 'queue:o:orders' });
  });

  it('returns all parallel tool results in one user message', async () => {
    const { llm, calls } = scripted([
      toolMsg({ id: 'a', name: 'search_graph', input: { query: 'orders' } }, { id: 'b', name: 'get_neighbors', input: { id: 'queue:o:orders' } }),
      textMsg('ok'),
    ]);
    await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    const results = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => r.tool_use_id)).toEqual(['a', 'b']);
  });

  it('sends validation errors back and tells the model to stop after repeated invalid scenes', async () => {
    const invalids = Array.from({ length: MAX_INVALID_SCENES }, (_, i) => toolMsg({ id: `bad${i}`, name: 'emit_scene', input: invalidScene }));
    const { llm, calls } = scripted([...invalids, textMsg('In text then.')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result.scenes).toEqual([]);
    expect(events.some((e) => e.type === 'scene')).toBe(false);
    const first = calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(first[0]).toMatchObject({ is_error: true });
    expect(first[0]!.content).not.toContain(STOP_EMITTING);
    const last = calls[MAX_INVALID_SCENES]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(last[0]!.content).toContain(STOP_EMITTING);
  });

  it('reports invalid tool input as an error result', async () => {
    const { llm, calls } = scripted([toolMsg({ id: 'x', name: 'search_graph', input: { query: 42 } }), textMsg('ok')]);
    await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    expect((calls[1]!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[])[0]).toMatchObject({ is_error: true });
  });

  it('stops on refusal without appending the refused turn', async () => {
    const { llm } = scripted([msg([{ type: 'text', text: '' }], 'refusal')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result).toMatchObject({ stop: 'error', appended: [] });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'refusal' });
  });

  it('never runs tools cut off by max_tokens', async () => {
    const run = vi.fn();
    const { llm } = scripted([msg([{ type: 'tool_use', id: 't', name: 'search_graph', input: { query: 'or' } }], 'max_tokens')]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx: { ...ctx, loadGraph: run }, emit });
    expect(run).not.toHaveBeenCalled();
    expect(result.appended).toEqual([]);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'max_tokens' });
  });

  it('stops after the iteration cap', async () => {
    const loop = Array.from({ length: MAX_ITERATIONS + 1 }, (_, i) => toolMsg({ id: `l${i}`, name: 'search_graph', input: { query: 'orders' } }));
    const { llm, calls } = scripted(loop);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(calls).toHaveLength(MAX_ITERATIONS);
    expect(result.stop).toBe('error');
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'max_iterations' });
    expect(result.appended.length % 2).toBe(0);
  });

  it('retries a turn whose streamed tool input was not parseable JSON', async () => {
    const { llm, calls } = scripted([new SyntaxError('Unexpected end of JSON input'), textMsg('ok')]);
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} });
    expect(calls).toHaveLength(2);
    expect(result.stop).toBe('end_turn');
  });

  it('reports API errors and keeps only complete pairs', async () => {
    const apiError = new Anthropic.APIError(529, { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, 'Overloaded', new Headers());
    const { llm } = scripted([toolMsg({ id: 't1', name: 'search_graph', input: { query: 'orders' } }), apiError]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit });
    expect(result.stop).toBe('error');
    expect(result.appended.map((m) => m.role)).toEqual(['assistant', 'user']);
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'llm_error' });
  });

  it('stops quietly when the client aborted', async () => {
    const controller = new AbortController();
    const { llm } = scripted([(input) => { controller.abort(); throw Object.assign(new Error('aborted'), { name: 'AbortError', signal: input.signal }); }]);
    const { events, emit } = collect();
    const result = await runAgent({ llm, system: 's', history: [], user, ctx, emit, signal: controller.signal });
    expect(result).toMatchObject({ stop: 'error', appended: [] });
    expect(events.at(-1)).toMatchObject({ type: 'error', code: 'aborted' });
  });

  it('keeps usage in the caller-owned accumulator even when a later step throws', async () => {
    const { llm } = scripted([toolMsg({ id: 't', name: 'emit_scene', input: validScene })]);
    const usageBox = { input: 0, output: 0 };
    const emit = (e: AgentEvent) => { if (e.type === 'scene') throw new Error('db down'); };
    await expect(runAgent({ llm, system: 's', history: [], user, ctx, emit, usage: usageBox })).rejects.toThrow('db down');
    expect(usageBox).toEqual({ input: 15, output: 5 });
  });

  it('reports the error code of a failed turn', async () => {
    const { llm } = scripted([msg([{ type: 'text', text: '' }], 'refusal')]);
    expect(await runAgent({ llm, system: 's', history: [], user, ctx, emit: () => {} })).toMatchObject({ stop: 'error', errorCode: 'refusal' });
  });
});
