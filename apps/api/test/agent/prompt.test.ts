import { describe, expect, it } from 'vitest';
import { questionOf, SYSTEM_PROMPT, userTurn } from '../../src/agent/prompt';

describe('SYSTEM_PROMPT', () => {
  it('explains the product, the tools and the scene vocabulary', () => {
    for (const word of ['search_graph', 'emit_scene', 'actor', 'compute', 'storage', 'channel', 'external', 'logic', 'data', 'risks', 'substeps', 'graphRef']) {
      expect(SYSTEM_PROMPT).toContain(word);
    }
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('userTurn', () => {
  it('puts the language, repositories and focus before the question', () => {
    const turn = userTurn('How are orders paid?', { language: 'es', focus: { label: 'worker', graphRef: 'svc:r1' }, repos: ['acme/api', 'acme/worker'] });
    expect(turn.role).toBe('user');
    const texts = (turn.content as { type: string; text: string }[]).map((b) => b.text);
    expect(texts[0]).toBe('Respond in Spanish (es). Scene titles, labels, summaries and narration must be in that language.');
    expect(texts[1]).toBe('Indexed repositories: acme/api, acme/worker.');
    expect(texts[2]).toMatch(/^Mode: analyze/);
    expect(texts[3]).toBe('The user is looking at "worker" (graph id svc:r1).');
    expect(texts.at(-1)).toBe('How are orders paid?');
    expect(questionOf(turn)).toBe('How are orders paid?');
  });

  it('handles unknown languages and no repositories', () => {
    const texts = (userTurn('q', { language: 'fr', repos: [] }).content as { text: string }[]).map((b) => b.text);
    expect(texts[0]).toBe('Respond in fr (fr). Scene titles, labels, summaries and narration must be in that language.');
    expect(texts[1]).toBe('No repositories are indexed yet.');
    expect(questionOf({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] })).toBeNull();
  });
});

describe('modes and scope', () => {
  it('frames the turn for analysis or planning', () => {
    const analyze = JSON.stringify(userTurn('How does login work?', { language: 'en', repos: [], mode: 'analyze' }).content);
    const plan = JSON.stringify(userTurn('Switch to SHA-256', { language: 'en', repos: [], mode: 'plan' }).content);
    expect(analyze).toContain('Mode: analyze');
    expect(analyze).toContain('Do not create a Solution');
    expect(plan).toContain('Mode: plan');
    expect(plan).toContain('upsert_solution');
    expect(JSON.stringify(userTurn('q', { language: 'en', repos: [] }).content)).toContain('Mode: analyze');
  });

  it('keeps the agent on the repositories and explains pull request reviews', () => {
    expect(SYSTEM_PROMPT).toContain('Only help with');
    expect(SYSTEM_PROMPT).toContain('get_pr_diff');
    expect(SYSTEM_PROMPT).toMatch(/pull request/i);
  });
});

