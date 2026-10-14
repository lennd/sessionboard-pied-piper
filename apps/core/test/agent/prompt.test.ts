import { describe, expect, it } from 'vitest';
import { chatPrompt, explainPrompt, MAP_MARKER, questionOf, rulesBlock, runFeaturePrompt, runSolutionPrompt, SYSTEM_PROMPT, systemMapPrompt, toolkitBlock } from '../../src/agent/prompt';

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

describe('team rules', () => {
  it('adds the rules to chat and explain prompts and asks for "Rule:" risks', () => {
    expect(rulesBlock([])).toBe('');
    const chat = chatPrompt('q', { language: 'en', rules: ['No raw SQL in handlers'] });
    expect(chat).toContain('title starts with "Rule:"');
    expect(chat).toContain('- No raw SQL in handlers');
    expect(chatPrompt('q', { language: 'en', rules: [] })).not.toContain('Rule:');
    const explain = explainPrompt({ language: 'en', repoName: 'r', source: 's', touched: [], diff: '', systemMap: null, rules: ['Every endpoint validates its body'] });
    expect(explain).toContain('- Every endpoint validates its body');
  });
});

describe('toolkit', () => {
  it('tells the agent which harness to install only when missing and which commands to use', () => {
    const toolkit = 'Install the devflow plugin with `claude plugin install devflow` if /devflow is missing.\nRun unit tests with `npm run test:unit`.';
    expect(toolkitBlock('')).toBe('');
    expect(toolkitBlock(toolkit)).toContain('only when it is actually missing');
    expect(runSolutionPrompt('sol', toolkit)).toContain('npm run test:unit');
    expect(runSolutionPrompt('sol')).not.toContain('Tooling for this repository');
    expect(chatPrompt('q', { language: 'en', toolkit })).toContain('claude plugin install devflow');
  });
});

describe('features', () => {
  it('prepends the feature context to chat prompts and scopes runs to one repository', () => {
    expect(chatPrompt('q', { language: 'en', context: 'Repositories:\n- api → /w/api' })).toContain('Repositories:');
    const run = runFeaturePrompt('f1', 'sol', 'shop-web', 'npm test');
    expect(run).toContain('Implement only the tasks whose repo is "shop-web"');
    expect(run).toContain('get_solution with id sol');
    expect(run).toContain('blocked');
    expect(run).toContain('npm test');
  });
});
