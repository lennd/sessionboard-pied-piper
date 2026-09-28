import type Anthropic from '@anthropic-ai/sdk';

export type LlmTurnInput = {
  system: string;
  messages: Anthropic.Beta.BetaMessageParam[];
  tools: Anthropic.Beta.BetaTool[];
  onText?: (delta: string) => void;
  signal?: AbortSignal;
};

export type LlmClient = { model: string; turn(input: LlmTurnInput): Promise<Anthropic.Beta.BetaMessage> };
