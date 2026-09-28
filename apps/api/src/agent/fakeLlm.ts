import type Anthropic from '@anthropic-ai/sdk';
import type { LlmClient } from './llm';

type Message = Anthropic.Beta.BetaMessage;
type Param = Anthropic.Beta.BetaMessageParam;
type SearchHit = { id: string; label: string; name: string; summary?: string };

export const FAKE_MODEL = 'fake-scripted';
export const TRANSLATE_MARKER = 'Target language:';
const MAX_SCENE_PIECES = 5;
const LANGUAGE_DIRECTIVE = /\(([a-z]{2,3}(?:-[A-Za-z0-9]+)*)\)\./;
const ROLE_BY_LABEL: Record<string, string> = { Queue: 'channel', Table: 'storage', External: 'external', ConfigKey: 'data', File: 'logic' };

let counter = 0;
const nextId = (prefix: string) => `${prefix}_fake_${++counter}`;

const message = (content: unknown[], stopReason: 'tool_use' | 'end_turn'): Message =>
  ({
    id: nextId('msg'), type: 'message', role: 'assistant', model: FAKE_MODEL, content, stop_reason: stopReason, stop_sequence: null,
    usage: { input_tokens: 100, output_tokens: 20, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
  }) as unknown as Message;

const toolUse = (name: string, input: unknown) => message([{ type: 'tool_use', id: nextId('toolu'), name, input }], 'tool_use');
const text = (value: string) => message([{ type: 'text', text: value, citations: null }], 'end_turn');

const blocks = (param: Param): { type: string; text?: string; tool_use_id?: string; content?: unknown }[] =>
  typeof param.content === 'string' ? [{ type: 'text', text: param.content }] : (param.content as { type: string }[]);

const textOf = (param: Param) => blocks(param).filter((b) => b.type === 'text').map((b) => b.text ?? '');

const toolNameFor = (messages: Param[], toolUseId: string): string | null => {
  for (const m of messages) {
    if (m.role !== 'assistant') continue;
    for (const b of blocks(m) as { type: string; id?: string; name?: string }[]) if (b.type === 'tool_use' && b.id === toolUseId) return b.name ?? null;
  }
  return null;
};

const languageOf = (messages: Param[]) => {
  for (const m of [...messages].reverse()) {
    if (m.role !== 'user') continue;
    for (const t of textOf(m)) {
      const match = LANGUAGE_DIRECTIVE.exec(t);
      if (match?.[1]) return match[1];
    }
  }
  return 'en';
};

const sceneFrom = (hits: SearchHit[], language: string) => {
  const pieces = hits.slice(0, MAX_SCENE_PIECES);
  const nodes = pieces.map((h, i) => ({ id: `p${i + 1}`, label: h.name.slice(0, 110), role: ROLE_BY_LABEL[h.label] ?? 'compute', kind: h.label, summary: h.summary || h.name, graphRef: h.id }));
  const edges = nodes.slice(1).map((n, i) => ({ id: `e${i + 1}`, from: nodes[i]!.id, to: n.id, kind: 'calls' }));
  const steps = edges.map((e, i) => ({ id: `s${i + 1}`, narration: `Step ${i + 1}: ${nodes[i + 1]!.label}.`, focus: [e.to], travel: { edgeId: e.id } }));
  return { id: nextId('scene'), title: `About ${pieces[0]?.name ?? 'the system'}`, language, nodes, edges, steps };
};

export const createFakeLlm = (): LlmClient => ({
  model: FAKE_MODEL,
  async turn({ messages, onText }) {
    const last = messages.at(-1);
    if (!last || last.role !== 'user') return text('Nothing to answer.');
    const lastBlocks = blocks(last);
    const result = lastBlocks.find((b) => b.type === 'tool_result');
    if (!result) {
      const question = textOf(last).at(-1) ?? '';
      if (question.startsWith(TRANSLATE_MARKER)) {
        const [header, ...rest] = question.split('\n');
        const language = header!.slice(TRANSLATE_MARKER.length).trim();
        const scene = JSON.parse(rest.join('\n').trim()) as Record<string, unknown>;
        return toolUse('emit_scene', { ...scene, language });
      }
      return toolUse('search_graph', { query: question });
    }
    const tool = toolNameFor(messages, result.tool_use_id ?? '');
    const payload = typeof result.content === 'string' ? result.content : JSON.stringify(result.content);
    if (tool === 'search_graph') {
      const hits = JSON.parse(payload) as SearchHit[];
      if (hits.length === 0) {
        onText?.('I could not find matching pieces in the indexed repositories.');
        return text('I could not find matching pieces in the indexed repositories.');
      }
      return toolUse('emit_scene', sceneFrom(hits, languageOf(messages)));
    }
    const answer = `Here is how it fits together. ${payload.split('\n')[0]}`;
    onText?.(answer);
    return text(answer);
  },
});
