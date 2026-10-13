import { sampleRegistry } from '@rdi/scene';
import { describe, expect, it, vi } from 'vitest';
import { executeTool, mcpToolName, sceneInputSchema, TOOL_NAMES, TOOL_SHAPES, type ToolContext } from '../../src/agent/tools';

const ctx: ToolContext = { upsertSolution: async () => ({ id: 'x', n: 1, title: 'x' }) };
const run = async (name: string, input: unknown) => executeTool(name, input, ctx);

describe('tool definitions', () => {
  it('exposes a zod shape per tool and the scene JSON schema without $schema', () => {
    expect(Object.keys(TOOL_SHAPES)).toEqual([...TOOL_NAMES]);
    expect(Object.keys(TOOL_SHAPES.emit_scene)).toEqual(expect.arrayContaining(['id', 'title', 'language', 'nodes']));
    expect(sceneInputSchema).toMatchObject({ type: 'object', required: expect.arrayContaining(['id', 'title', 'language', 'nodes']) });
    expect(sceneInputSchema).not.toHaveProperty('$schema');
    expect(mcpToolName('emit_scene')).toBe('mcp__rdi__emit_scene');
  });
});

describe('emit_scene', () => {
  it('accepts a valid scene and returns it', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.scene?.id).toBe('iot-telemetry');
    expect(outcome.content).toMatch(/^Scene "IoT telemetry ingestion" rendered/);
  });

  it('returns validation errors for an invalid scene', async () => {
    const outcome = await run('emit_scene', { id: 'x', title: 'X', language: 'en', nodes: [{ id: 'a', label: 'A', role: 'wizard', kind: 'svc', summary: 's' }] });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toMatch(/role/);
    expect(outcome.scene).toBeUndefined();
  });

  it('rejects unknown tools', async () => {
    expect(await run('rm_rf', {})).toMatchObject({ isError: true, content: 'Unknown tool "rm_rf".' });
  });
});

describe('tool failures', () => {
  it('turns exceptions into error results the model can recover from', async () => {
    const failing: ToolContext = { upsertSolution: async () => { throw new Error('disk full'); } };
    const scene = sampleRegistry['iot-telemetry']!;
    expect(await executeTool('upsert_solution', { title: 'x', summary: 'x', sceneProposed: scene }, failing)).toMatchObject({ isError: true, content: 'Tool upsert_solution failed: disk full' });
  });
});

describe('upsert_solution', () => {
  it('validates the draft and stores it through the context', async () => {
    const scene = sampleRegistry['iot-telemetry']!;
    const upsert = vi.fn().mockResolvedValue({ id: 'sol1', n: 1, title: 'Rate limits' });
    const outcome = await executeTool('upsert_solution', { title: 'Rate limits', summary: 'Throttle devices', sceneProposed: scene, plan: [{ id: 't1', title: 'Limiter', nodeRefs: [scene.nodes[0]!.id] }] }, { upsertSolution: upsert });
    expect(outcome).toMatchObject({ solution: { id: 'sol1', n: 1, title: 'Rate limits' } });
    expect(outcome.content).toBe('Solution "Rate limits" saved as version 1 (id sol1).');
    expect(upsert).toHaveBeenCalledWith({ title: 'Rate limits', solutionId: undefined, draft: expect.objectContaining({ summary: 'Throttle devices' }) });
  });

  it('returns the validation errors of an invalid draft without storing it', async () => {
    const upsert = vi.fn();
    const outcome = await executeTool('upsert_solution', { title: 'x', summary: 'x', plan: [{ id: 't1', title: 'A', dependsOn: ['nope'] }] }, { upsertSolution: upsert });
    expect(outcome).toMatchObject({ isError: true });
    expect(outcome.content).toContain('dependsOn "nope"');
    expect(upsert).not.toHaveBeenCalled();
  });
});

describe('emit_scene repairs', () => {
  it('drops internal pieces from groups and complexity on non-logic pieces instead of rejecting the scene', async () => {
    const scene = {
      id: 'saml', title: 'SAML', language: 'en',
      nodes: [
        { id: 'api', label: 'API', role: 'compute', kind: 'svc', summary: 's', complexity: { time: 'O(1)' } },
        { id: 'router', label: 'Router', role: 'logic', kind: 'router', summary: 's', parent: 'api', complexity: { time: 'O(n)' } },
        { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's' },
      ],
      groups: [{ id: 'g1', label: 'Backend', nodeIds: ['api', 'router'] }, { id: 'g2', label: 'Inner', nodeIds: ['router'] }],
    };
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    expect(outcome.scene!.groups).toEqual([{ id: 'g1', label: 'Backend', nodeIds: ['api'] }]);
    expect(outcome.scene!.nodes.find((n) => n.id === 'api')!.complexity).toBeUndefined();
    expect(outcome.scene!.nodes.find((n) => n.id === 'router')!.complexity).toEqual({ time: 'O(n)' });
    expect(outcome.content).toContain('Auto-fixed');
  });

  it('repairs dangling references and misplaced sub-steps by lifting them into the walkthrough', async () => {
    const scene = {
      id: 'saml', title: 'SAML', language: 'en',
      nodes: [
        { id: 'api', label: 'API', role: 'compute', kind: 'svc', summary: 's' },
        { id: 'job', label: 'Rotation job', role: 'compute', kind: 'cron', summary: 's', parent: 'ghost' },
        { id: 'db', label: 'DB', role: 'storage', kind: 'pg', summary: 's' },
      ],
      edges: [{ id: 'e1', from: 'api', to: 'db', kind: 'write' }, { id: 'e2', from: 'api', to: 'nowhere', kind: 'sync' }],
      steps: [
        { id: 's1', narration: 'Writes the IdP', focus: ['api', 'missing'], travel: { edgeId: 'e2' } },
        { id: 's2', narration: 'Rotation', expand: 'detalle de la rotación', substeps: [{ id: 's2a', narration: 'Generate cert', focus: ['job'] }] },
        { id: 's3', narration: 'Orphan substeps', substeps: [{ id: 's3a', narration: 'Inner', focus: ['db'], travel: { edgeId: 'e1' } }] },
      ],
      risks: [{ id: 'r1', category: 'security', severity: 'high', title: 'Expired cert', explanation: 'x', nodeIds: ['job', 'ghost'] }, { id: 'r2', category: 'security', severity: 'low', title: 'Gone', explanation: 'x', nodeIds: ['ghost'] }],
    };
    const outcome = await run('emit_scene', scene);
    expect(outcome.isError).toBeFalsy();
    const repaired = outcome.scene!;
    expect(repaired.steps.map((st) => st.id)).toEqual(['s1', 's2', 's2a', 's3', 's3a']);
    expect(repaired.steps[0]).toMatchObject({ focus: ['api'] });
    expect(repaired.steps[0]!.travel).toBeUndefined();
    expect(repaired.steps[4]!.travel).toMatchObject({ edgeId: 'e1' });
    expect(repaired.edges.map((e) => e.id)).toEqual(['e1']);
    expect(repaired.nodes.find((n) => n.id === 'job')!.parent).toBeUndefined();
    expect(repaired.risks.map((r) => [r.id, r.nodeIds])).toEqual([['r1', ['job']]]);
  });
});
