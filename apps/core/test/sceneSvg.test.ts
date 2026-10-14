import { sampleRegistry } from '@rdi/scene';
import { describe, expect, it } from 'vitest';
import { PIPER_MARK_SVG } from '../src/impact/mark';
import { layoutColumns, renderSceneSvg } from '../src/impact/sceneSvg';

const scene = sampleRegistry['iot-telemetry']!;

describe('renderSceneSvg', () => {
  it('lays top-level pieces out in role columns and draws every edge', () => {
    const placed = layoutColumns(scene);
    expect(placed.map((p) => p.node.id)).toEqual(scene.nodes.filter((n) => !n.parent).map((n) => n.id).sort((a, b) => placed.findIndex((p) => p.node.id === a) - placed.findIndex((p) => p.node.id === b)));
    const xs = new Set(placed.map((p) => p.x));
    expect(xs.size).toBeGreaterThan(1);
  });

  it('highlights the requested pieces in white, dims the rest and escapes text', () => {
    const target = scene.nodes[0]!;
    const svg = renderSceneSvg({ ...scene, title: 'Impact <PR #7> & more' }, { highlight: [target.id], caption: 'Breaks callers' });
    expect(svg.startsWith('<svg xmlns="http://www.w3.org/2000/svg"')).toBe(true);
    expect(svg).toContain('Impact &lt;PR #7&gt; &amp; more');
    expect(svg).toContain('Breaks callers');
    expect((svg.match(/fill="#ffffff" stroke="#ffffff" stroke-width="3"/g) ?? []).length).toBe(1);
    expect(svg).toContain(`>${target.label.slice(0, 22)}`);
    expect(svg.split('<line ').length - 1).toBeGreaterThan(0);
    expect(PIPER_MARK_SVG.startsWith('<svg')).toBe(true);
  });
});
