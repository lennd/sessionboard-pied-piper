import { sampleRegistry } from '@rdi/scene';
import { solutionScenes, subscribeSolution, type SolutionDetail } from '../../src/shell/solutions/solutionsApi';

const scene = sampleRegistry['iot-telemetry']!;
const detail = (current: boolean): SolutionDetail => ({
  id: 'sol', title: 'Rate limits', status: 'draft', conversationId: null, versions: [{ n: 3, author: 'web', summary: 's', createdAt: '2026-10-01T10:00:00Z' }],
  version: { n: 3, author: 'web', createdAt: '2026-10-01T10:00:00Z', draft: { summary: 's', sceneProposed: { ...scene, nodes: scene.nodes.slice(1) }, sceneCurrent: current ? scene : null, plan: [], risks: [] } },
  tasks: {},
});
const t = (key: string, params?: Record<string, string | number>) => `${key}:${params?.n ?? ''}`;

describe('solutionScenes', () => {
  it('offers proposed, current and changes scenes with unique ids and version titles', () => {
    const scenes = solutionScenes(detail(true), t as never);
    expect(scenes.map((s) => s.id)).toEqual(['sol-v3-proposed', 'sol-v3-current', 'sol-v3-changes']);
    expect(scenes.map((s) => s.title)).toEqual(['scene.proposed:3', 'scene.current:3', 'scene.changes:3']);
    expect(scenes[2]!.nodes.find((n) => n.id === scene.nodes[0]!.id)!.change).toBe('removed');
  });

  it('only offers the proposed scene when there is no current one', () => {
    expect(solutionScenes(detail(false), t as never).map((s) => s.id)).toEqual(['sol-v3-proposed']);
  });
});

describe('subscribeSolution', () => {
  it('listens to the solution event stream and closes it', () => {
    const instances: { url: string; listeners: Record<string, () => void>; closed: boolean }[] = [];
    class FakeEventSource {
      listeners: Record<string, () => void> = {};
      closed = false;
      constructor(public url: string) { instances.push(this); }
      addEventListener(type: string, fn: () => void) { this.listeners[type] = fn; }
      close() { this.closed = true; }
    }
    vi.stubGlobal('EventSource', FakeEventSource);
    const onEvent = vi.fn();
    const stop = subscribeSolution('/repos/r1', 'sol', onEvent);
    expect(instances[0]!.url).toBe('/api/repos/r1/solutions/sol/events');
    instances[0]!.listeners.solution!();
    expect(onEvent).toHaveBeenCalled();
    stop();
    expect(instances[0]!.closed).toBe(true);
    vi.unstubAllGlobals();
  });
});
