import Anthropic from '@anthropic-ai/sdk';

export type ChatMode = 'analyze' | 'plan';
export type ScopeInput = { question: string; mode: ChatMode; repos: string[]; previous: string | null };
export type ScopeVerdict = { inScope: boolean; usage: { input: number; output: number } };
export type ScopeGuard = (input: ScopeInput) => Promise<ScopeVerdict>;

export const SCOPE_MODEL = 'claude-haiku-4-5';
const SCOPE_MAX_TOKENS = 4;
const NO_USAGE = { input: 0, output: 0 };
const OFF_TOPIC = /\b(weather|recipe|joke|clima|receta|chiste)\b/i;

const SCOPE_SYSTEM = [
  'You screen messages sent to Repository Designer, a tool that explains software repositories and helps plan changes to them.',
  'Answer IN when the message asks to understand, explain, review, analyze, find, compare or document anything in the listed repositories (code, architecture, flows, data, risks, pull requests), or to plan or design a change to them. Greetings, thanks and short follow-ups to such a conversation are IN.',
  'Answer OUT for everything else: general knowledge, other topics, unrelated writing, jokes, personal or legal advice.',
  'Reply with exactly one word: IN or OUT.',
].join('\n');

const REFUSALS: Record<string, string> = {
  en: 'I can only help analyze the connected repositories or plan changes to them. Ask how something works, what a change affects or where the risks are, or switch to Plan and describe the change you want.',
  es: 'Solo puedo ayudarte a analizar los repositorios conectados o a planificar cambios en ellos. Preguntame cómo funciona algo, qué afecta un cambio o dónde están los riesgos, o pasá a Planificar y describí el cambio que querés.',
  pt: 'Só posso ajudar a analisar os repositórios conectados ou planejar mudanças neles. Pergunte como algo funciona, o que uma mudança afeta ou onde estão os riscos, ou passe para Planejar e descreva a mudança que você quer.',
};

export const refusalFor = (language: string): string => REFUSALS[language.split('-')[0] ?? 'en'] ?? REFUSALS.en!;

/** One cheap Haiku call before the agent runs; fails open so an outage never blocks legitimate questions. */
export const createAnthropicScopeGuard = (client: Anthropic = new Anthropic()): ScopeGuard => async ({ question, mode, repos, previous }) => {
  try {
    const response = await client.messages.create({
      model: SCOPE_MODEL,
      max_tokens: SCOPE_MAX_TOKENS,
      system: SCOPE_SYSTEM,
      messages: [{
        role: 'user',
        content: [`Repositories: ${repos.length > 0 ? repos.join(', ') : 'none yet'}`, `Mode: ${mode}`, ...(previous ? [`Previous message: ${previous}`] : []), `Message: ${question}`].join('\n'),
      }],
    });
    const answer = response.content.filter((b): b is Anthropic.TextBlock => b.type === 'text').map((b) => b.text).join('').trim().toUpperCase();
    return { inScope: !answer.startsWith('OUT'), usage: { input: response.usage.input_tokens, output: response.usage.output_tokens } };
  } catch {
    return { inScope: true, usage: NO_USAGE };
  }
};

export const createFakeScopeGuard = (): ScopeGuard => async ({ question }) => ({ inScope: !OFF_TOPIC.test(question), usage: NO_USAGE });
