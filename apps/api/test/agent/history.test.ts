import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it } from 'vitest';
import { windowHistory } from '../../src/agent/history';

type Param = Anthropic.Beta.BetaMessageParam;
const turn = (i: number, size = 10): Param[] => [
  { role: 'user', content: [{ type: 'text', text: `q${i}` }] },
  { role: 'assistant', content: [{ type: 'tool_use', id: `t${i}`, name: 'search_graph', input: { query: 'x'.repeat(size) } }] },
  { role: 'user', content: [{ type: 'tool_result', tool_use_id: `t${i}`, content: 'r' }] },
  { role: 'assistant', content: [{ type: 'text', text: `a${i}` }] },
];
const questions = (messages: Param[]) => messages.flatMap((m) => (m.role === 'user' && Array.isArray(m.content) && m.content[0]?.type === 'text' ? [(m.content[0] as { text: string }).text] : []));

describe('windowHistory', () => {
  it('keeps whole recent turns within the turn limit', () => {
    const history = [1, 2, 3, 4, 5].flatMap((i) => turn(i));
    const windowed = windowHistory(history, { maxTurns: 2, maxChars: 1_000_000 });
    expect(questions(windowed)).toEqual(['q4', 'q5']);
    expect(windowed[0]!.role).toBe('user');
  });

  it('drops the oldest turns until the history fits the character budget', () => {
    const history = [...turn(1, 5000), ...turn(2, 5000), ...turn(3, 10)];
    expect(questions(windowHistory(history, { maxTurns: 10, maxChars: 6000 }))).toEqual(['q2', 'q3']);
    expect(windowHistory([], { maxTurns: 3, maxChars: 10 })).toEqual([]);
  });
});
