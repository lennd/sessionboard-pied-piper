// @vitest-environment node
import { sampleSceneRegistry } from '@rdi/scene';
import { layoutScene, NODE_HEIGHT, NODE_WIDTH } from '../src/canvas/layout';

const flow = sampleSceneRegistry['speaker-sync-flow']!;

const absolute = (layout: Awaited<ReturnType<typeof layoutScene>>, id: string) => {
  const box = layout.nodes[id]!;
  const parent = box.parentId ? layout.groups[box.parentId]! : { x: 0, y: 0 };
  return { x: box.x + parent.x, y: box.y + parent.y };
};

describe('layoutScene', () => {
  it('positions every node with fixed size', async () => {
    const layout = await layoutScene(flow);
    flow.nodes.forEach((n) => {
      expect(layout.nodes[n.id]).toMatchObject({ width: NODE_WIDTH, height: NODE_HEIGHT });
    });
  });

  it('nests grouped nodes under their group', async () => {
    const layout = await layoutScene(flow);
    expect(layout.nodes.worker!.parentId).toBe('g-api');
    expect(layout.nodes.organizer!.parentId).toBeUndefined();
    expect(layout.groups['g-api']!.width).toBeGreaterThan(NODE_WIDTH);
  });

  it('lays out left to right along edges', async () => {
    const layout = await layoutScene(flow);
    expect(absolute(layout, 'organizer').x).toBeLessThan(absolute(layout, 'web').x);
    expect(absolute(layout, 'web').x).toBeLessThan(absolute(layout, 'sync-endpoint').x);
  });

  it('keeps root-level nodes from overlapping', async () => {
    const layout = await layoutScene(sampleSceneRegistry['pr-impact']!);
    const boxes = Object.values(layout.nodes);
    boxes.forEach((a, i) =>
      boxes.slice(i + 1).forEach((b) => {
        const overlap = a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
        expect(overlap).toBe(false);
      }),
    );
  });
});
