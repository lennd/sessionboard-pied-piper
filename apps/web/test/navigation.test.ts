import { sampleSceneRegistry } from '@rdi/scene';
import { currentSceneId, enterZoom, goToDepth, rootNav } from '../src/engine/navigation';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

describe('navigation', () => {
  it('zooms into a node with a registered sub-scene', () => {
    const nav = enterZoom(rootNav(flow.id), flow, 'worker', sampleSceneRegistry);
    expect(nav.stack).toEqual(['speaker-sync-flow', 'speaker-reconcile-algorithm']);
    expect(currentSceneId(nav)).toBe('speaker-reconcile-algorithm');
  });

  it('ignores nodes without zoom', () => {
    const nav = rootNav(flow.id);
    expect(enterZoom(nav, flow, 'web', sampleSceneRegistry)).toBe(nav);
  });

  it('ignores zoom targets missing from the registry', () => {
    const nav = rootNav(flow.id);
    const broken = { ...flow, zoom: { worker: 'does-not-exist' } };
    expect(enterZoom(nav, broken, 'worker', sampleSceneRegistry)).toBe(nav);
  });

  it('goes back to a breadcrumb depth', () => {
    const nav = enterZoom(rootNav(flow.id), flow, 'worker', sampleSceneRegistry);
    expect(goToDepth(nav, 0).stack).toEqual(['speaker-sync-flow']);
    expect(goToDepth(nav, 5)).toBe(nav);
  });
});
