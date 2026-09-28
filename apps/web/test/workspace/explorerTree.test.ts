import { computeVisible, indexScene } from '@rdi/scene/v2';
import { buildExplorerTree } from '../../src/workspace/panels/explorerTree';
import { risksByNode } from '../../src/workspace/engine/risks';
import { fixtureScene } from './fixture';

const scene = fixtureScene();
const index = indexScene(scene);
const tree = (level: Parameters<typeof computeVisible>[2], local: string[] = []) =>
  buildExplorerTree(scene, index, computeVisible(scene, index, level, new Set(local)), risksByNode(scene)).map(
    (i) => `${'  '.repeat(i.depth)}${i.expandable ? (i.expanded ? '▾' : '▸') : '·'} ${i.id}`,
  );

describe('buildExplorerTree', () => {
  it('architecture: repo groups with top-level pieces, collapsed parents expandable', () => {
    expect(tree('architecture')).toEqual(['▾ group:web', '  · client', '▾ group:svc', '  · api', '  ▸ worker', '  · db', '· pay']);
  });

  it('components and local expansion reveal nested pieces', () => {
    expect(tree('components')).toEqual(['▾ group:web', '  · client', '▾ group:svc', '  · api', '  ▾ worker', '    ▸ reserve', '  · db', '· pay']);
    expect(tree('architecture', ['reserve'])).toContain('      · lock');
  });

  it('system: repo boxes listing their members', () => {
    expect(tree('system')).toEqual(['▾ repo:web', '  · client', '▾ repo:svc', '  · api', '  · worker', '  · db', '· pay']);
  });

  it('carries node ids and aggregated severity', () => {
    const items = buildExplorerTree(scene, index, computeVisible(scene, index, 'architecture', new Set()), risksByNode(scene));
    expect(items.find((i) => i.id === 'worker')).toMatchObject({ nodeId: 'worker', severity: 'high', glyph: '⚙' });
    expect(items.find((i) => i.id === 'group:svc')).toMatchObject({ nodeId: null, glyph: '▣' });
  });
});
