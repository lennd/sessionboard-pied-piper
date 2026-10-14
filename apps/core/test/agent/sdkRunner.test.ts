import { sampleRegistry } from '@rdi/scene';
import { describe, expect, it, vi } from 'vitest';
import { createFakeQuery } from '../../src/agent/fakeQuery';
import { chatPrompt, systemMapPrompt } from '../../src/agent/prompt';
import { buildOptions, relativizeScene, runAgent, toolSummary, type AgentEvent } from '../../src/agent/sdkRunner';
import { agentConfig, scripted } from './scripted';

const ctx = { upsertSolution: async () => ({ id: 'sol', n: 1, title: 't' }) };
const collect = () => {
  const events: AgentEvent[] = [];
  return { events, emit: (e: AgentEvent) => { events.push(e); } };
};

describe('buildOptions', () => {
  it('keeps the agent read-only, registers the in-process tools and honours the configured limits', () => {
    const options = buildOptions({ cwd: '/repo', mode: 'analyze', agent: { ...agentConfig, model: 'claude-x', maxBudgetUsd: 2, claudeExecutable: '/bin/claude' }, abortController: new AbortController(), local: { call: async () => ({ content: '', summary: '' }) } });
    expect(options.cwd).toBe('/repo');
    expect(options.permissionMode).toBe('dontAsk');
    expect(options.allowedTools).toEqual(expect.arrayContaining(['Read', 'Grep', 'Glob', 'mcp__rdi__emit_scene', 'mcp__rdi__upsert_solution']));
    expect(options.disallowedTools).toEqual(expect.arrayContaining(['Edit', 'Write']));
    expect(Object.keys(options.mcpServers ?? {})).toEqual(['rdi']);
    expect(options.systemPrompt).toMatchObject({ type: 'preset', preset: 'claude_code' });
    expect(options).toMatchObject({ model: 'claude-x', maxBudgetUsd: 2, maxTurns: 16, pathToClaudeCodeExecutable: '/bin/claude' });
    expect(buildOptions({ cwd: '/r', mode: 'map', resume: 's1', agent: agentConfig, abortController: new AbortController(), local: { call: async () => ({ content: '', summary: '' }) } })).toMatchObject({ resume: 's1' });
  });
});

describe('runAgent', () => {
  it('maps SDK messages to agent events and collects scenes, session and usage', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const fn = scripted([{ text: 'Looking. ' }, { tool: 'Read', input: { file_path: 'src/a.ts' } }, { tool: 'emit_scene', input: scene }, { text: 'Done.' }, { result: 'success', text: 'Done.' }]);
    const { events, emit } = collect();
    const result = await runAgent(fn, { cwd: '/r', prompt: 'q', mode: 'analyze', agent: agentConfig, ctx, emit });
    expect(result).toMatchObject({ stop: 'end_turn', sessionId: 'session-1', text: 'Looking. Done.', usage: { input: 7, output: 3, costUsd: 0.01 } });
    expect(result.scenes.map((s) => s.id)).toEqual(['iot-telemetry']);
    expect(events.map((e) => e.type)).toEqual(['text', 'tool', 'tool', 'tool', 'scene', 'tool', 'text']);
    expect(events[1]).toEqual({ type: 'tool', name: 'Read', status: 'running', summary: 'Read src/a.ts' });
    expect(events[2]).toMatchObject({ type: 'tool', name: 'Read', status: 'done' });
    expect(events[3]).toMatchObject({ type: 'tool', name: 'mcp__rdi__emit_scene', status: 'running' });
  });

  it('reports invalid scenes as tool errors and surfaces solution saves', async () => {
    const upsert = vi.fn().mockResolvedValue({ id: 'sol', n: 2, title: 'T' });
    const fn = scripted([{ tool: 'emit_scene', input: { id: 'x' } }, { tool: 'upsert_solution', input: { title: 'T', summary: 's', plan: [{ id: 't1', title: 'A' }] } }, { result: 'success' }]);
    const { events, emit } = collect();
    const result = await runAgent(fn, { cwd: '/r', prompt: 'q', mode: 'plan', agent: agentConfig, ctx: { upsertSolution: upsert }, emit });
    expect(result.scenes).toEqual([]);
    expect(events).toContainEqual({ type: 'tool', name: 'mcp__rdi__emit_scene', status: 'error', summary: 'mcp__rdi__emit_scene' });
    expect(events).toContainEqual({ type: 'solution', id: 'sol', n: 2, title: 'T' });
  });

  it('turns SDK result errors, thrown errors and aborts into error events', async () => {
    const { events, emit } = collect();
    expect(await runAgent(scripted([{ result: 'error_max_turns' }]), { cwd: '/r', prompt: 'q', mode: 'analyze', agent: agentConfig, ctx, emit })).toMatchObject({ stop: 'error', errorCode: 'max_iterations' });
    expect(await runAgent(scripted([{ throw: 'boom' }]), { cwd: '/r', prompt: 'q', mode: 'analyze', agent: agentConfig, ctx, emit })).toMatchObject({ stop: 'error', errorCode: 'llm_error' });
    const controller = new AbortController();
    controller.abort();
    expect(await runAgent(scripted([{ text: 'a' }, { result: 'success' }]), { cwd: '/r', prompt: 'q', mode: 'analyze', agent: agentConfig, ctx, emit, signal: controller.signal })).toMatchObject({ errorCode: 'aborted' });
    expect(events.filter((e) => e.type === 'error').map((e) => (e as { code: string }).code)).toEqual(['max_iterations', 'llm_error', 'aborted']);
  });

  it('relativizes against several roots and names the root in code.repo', () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const a = { ...scene.nodes[0]!, code: { repo: 'x', path: '/w/api/src/a.ts', startLine: 1, endLine: 2, language: 'ts' } };
    const b = { ...scene.nodes[1]!, code: { repo: 'x', path: '/w/web/src/b.tsx', startLine: 1, endLine: 2, language: 'ts' } };
    const result = relativizeScene({ ...scene, nodes: [a, b, ...scene.nodes.slice(2)] }, [{ id: '1', name: 'api', path: '/w/api' }, { id: '2', name: 'web', path: '/w/web' }]);
    expect(result.nodes[0]).toMatchObject({ repo: 'api', code: { path: 'src/a.ts', repo: 'api' } });
    expect(result.nodes[1]).toMatchObject({ repo: 'web', code: { path: 'src/b.tsx', repo: 'web' } });
    const options = buildOptions({ cwd: '/w/api', additionalDirectories: ['/w/web'], mode: 'plan', agent: agentConfig, abortController: new AbortController(), local: { call: async () => ({ content: '', summary: '' }) } });
    expect(options.additionalDirectories).toEqual(['/w/web']);
  });

  it('makes absolute code paths inside the repository relative', () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const node = { ...scene.nodes[0]!, code: { repo: 'r', path: '/repo/src/a.ts', startLine: 1, endLine: 2, language: 'ts' } };
    const outside = { ...scene.nodes[1]!, code: { repo: 'r', path: '/elsewhere/b.ts', startLine: 1, endLine: 2, language: 'ts' } };
    const result = relativizeScene({ ...scene, nodes: [node, outside, ...scene.nodes.slice(2)] }, '/repo');
    expect(result.nodes[0]!.code!.path).toBe('src/a.ts');
    expect(result.nodes[1]!.code!.path).toBe('/elsewhere/b.ts');
  });

  it('summarises built-in tool calls on one line', () => {
    expect(toolSummary('Grep', { pattern: 'login' })).toBe('Grep login');
    expect(toolSummary('Bash', { command: 'git log' })).toBe('Bash git log');
    expect(toolSummary('Glob', {})).toBe('Glob');
  });
});

describe('createFakeQuery', () => {
  it('draws a scene for a question, saves a solution in plan mode and reuses the session on resume', async () => {
    const fake = createFakeQuery();
    const { events, emit } = collect();
    const first = await runAgent(fake, { cwd: '/r', prompt: chatPrompt('How does login work?', { language: 'es' }), mode: 'analyze', agent: agentConfig, ctx, emit });
    expect(first.stop).toBe('end_turn');
    expect(first.scenes[0]).toMatchObject({ language: 'es', title: 'About How does login work?' });
    expect(events.some((e) => e.type === 'solution')).toBe(false);
    const second = await runAgent(fake, { cwd: '/r', prompt: chatPrompt('Add 2FA', { language: 'en', mode: 'plan' }), mode: 'plan', resume: first.sessionId, agent: agentConfig, ctx, emit });
    expect(second.sessionId).toBe(first.sessionId);
    expect(events.some((e) => e.type === 'solution')).toBe(true);
    const map = await runAgent(fake, { cwd: '/r', prompt: systemMapPrompt('en', 'repo'), mode: 'map', agent: agentConfig, ctx, emit });
    expect(map.scenes[0]!.id).toBe('system-map');
    expect(map.scenes[0]!.nodes.every((n) => n.code?.path)).toBe(true);
  });
});
