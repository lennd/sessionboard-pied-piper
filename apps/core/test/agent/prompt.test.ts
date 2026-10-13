import { describe, expect, it } from 'vitest';
import { chatPrompt, MAP_MARKER, questionOf, SYSTEM_PROMPT, systemMapPrompt } from '../../src/agent/prompt';

describe('SYSTEM_PROMPT', () => {
  it('explains the product, the tools and the scene vocabulary for a local repository', () => {
    for (const word of ['emit_scene', 'upsert_solution', 'Glob', 'Grep', 'Read', 'actor', 'compute', 'storage', 'channel', 'external', 'logic', 'data', 'risks', 'substeps', 'code {repo, path']) {
      expect(SYSTEM_PROMPT).toContain(word);
    }
    expect(SYSTEM_PROMPT).toContain('Only help with');
    expect(SYSTEM_PROMPT).toContain('Never modify files');
    expect(SYSTEM_PROMPT).not.toContain('search_graph');
    expect(SYSTEM_PROMPT).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });
});

describe('chatPrompt', () => {
  it('puts the language, mode and focus before the question', () => {
    const prompt = chatPrompt('How are orders paid?', { language: 'es', focus: { label: 'worker', graphRef: 'svc:r1' } });
    const parts = prompt.split('\n\n');
    expect(parts[0]).toBe('Respond in Spanish (es). Scene titles, labels, summaries and narration must be in that language.');
    expect(parts[1]).toMatch(/^Mode: analyze/);
    expect(parts[2]).toBe('The user is looking at "worker" (piece id svc:r1).');
    expect(parts.at(-1)).toBe('How are orders paid?');
    expect(questionOf({ role: 'user', content: 'How are orders paid?' })).toBe('How are orders paid?');
  });

  it('handles unknown languages and frames analysis or planning', () => {
    expect(chatPrompt('q', { language: 'fr' })).toContain('Respond in fr (fr).');
    expect(chatPrompt('q', { language: 'en', mode: 'analyze' })).toContain('Do not create a Solution');
    expect(chatPrompt('q', { language: 'en', mode: 'plan' })).toContain('upsert_solution');
    expect(questionOf({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 'x', content: 'y' }] })).toBeNull();
  });
});

describe('systemMapPrompt', () => {
  it('starts with the marker, names the repository and asks for code references', () => {
    const prompt = systemMapPrompt('pt', 'shop-api');
    expect(prompt.startsWith(MAP_MARKER)).toBe(true);
    expect(prompt).toContain('"shop-api"');
    expect(prompt).toContain('Portuguese');
    expect(prompt).toContain('code reference');
    expect(prompt).toContain('"system-map"');
  });
});
