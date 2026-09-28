import type Anthropic from '@anthropic-ai/sdk';

type Param = Anthropic.Beta.BetaMessageParam;

export const MAX_HISTORY_TURNS = 12;
export const MAX_HISTORY_CHARS = 300_000;

const startsTurn = (message: Param) =>
  message.role === 'user' && (typeof message.content === 'string' || !message.content.some((block) => block.type === 'tool_result'));

/** Keeps the most recent whole turns that fit the turn and size limits; the full history stays in the database. */
export const windowHistory = (messages: Param[], limits = { maxTurns: MAX_HISTORY_TURNS, maxChars: MAX_HISTORY_CHARS }): Param[] => {
  const starts = messages.flatMap((m, i) => (startsTurn(m) ? [i] : []));
  let first = starts.length > limits.maxTurns ? starts[starts.length - limits.maxTurns]! : (starts[0] ?? messages.length);
  const size = (from: number) => JSON.stringify(messages.slice(from)).length;
  for (const start of starts) {
    if (start < first) continue;
    first = start;
    if (size(start) <= limits.maxChars) break;
  }
  return messages.slice(first);
};
