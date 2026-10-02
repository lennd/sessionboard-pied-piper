import type Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';
import { createAnthropicScopeGuard, createFakeScopeGuard, refusalFor, SCOPE_MODEL } from '../../src/agent/scopeGuard';

const clientReturning = (create: (params: unknown) => Promise<unknown>) => ({ messages: { create: vi.fn(create) } }) as unknown as Anthropic & { messages: { create: ReturnType<typeof vi.fn> } };
const reply = (text: string) => ({ content: [{ type: 'text', text }], usage: { input_tokens: 40, output_tokens: 1 } });

describe('scope guard', () => {
  it('asks Haiku whether the message is about the repositories and reports its usage', async () => {
    const client = clientReturning(async () => reply('OUT'));
    const guard = createAnthropicScopeGuard(client);
    expect(await guard({ question: 'What is the weather in Madrid?', mode: 'analyze', repos: ['lennd/api'], previous: null })).toEqual({ inScope: false, usage: { input: 40, output: 1 } });
    const params = client.messages.create.mock.calls[0]![0] as { model: string; max_tokens: number; messages: { content: string }[] };
    expect(params.model).toBe(SCOPE_MODEL);
    expect(params.max_tokens).toBeLessThanOrEqual(16);
    expect(params.messages[0]!.content).toContain('lennd/api');
    expect(params.messages[0]!.content).toContain('What is the weather in Madrid?');
  });

  it('includes the previous question so short follow-ups keep their context', async () => {
    const client = clientReturning(async () => reply('IN'));
    const guard = createAnthropicScopeGuard(client);
    expect((await guard({ question: '¿y el logout?', mode: 'analyze', repos: [], previous: 'Help me review SAML' })).inScope).toBe(true);
    expect((client.messages.create.mock.calls[0]![0] as { messages: { content: string }[] }).messages[0]!.content).toContain('Help me review SAML');
  });

  it('lets the question through when the guard itself fails', async () => {
    const guard = createAnthropicScopeGuard(clientReturning(async () => { throw new Error('overloaded'); }));
    expect(await guard({ question: 'x', mode: 'plan', repos: [], previous: null })).toEqual({ inScope: true, usage: { input: 0, output: 0 } });
  });

  it('has a deterministic fake for development and tests', async () => {
    const guard = createFakeScopeGuard();
    expect((await guard({ question: '¿Qué clima hace hoy?', mode: 'analyze', repos: [], previous: null })).inScope).toBe(false);
    expect((await guard({ question: 'How does SAML login work?', mode: 'analyze', repos: [], previous: null })).inScope).toBe(true);
  });

  it('refuses in the conversation language', () => {
    expect(refusalFor('es')).toMatch(/^Solo puedo ayudarte/);
    expect(refusalFor('pt')).toMatch(/^Só posso ajudar/);
    expect(refusalFor('fr')).toMatch(/^I can only help/);
  });
});
