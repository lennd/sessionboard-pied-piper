// @vitest-environment node
import { findCycles } from '../../src/workspace/canvas/cycles';

describe('findCycles', () => {
  it('marks the edges and nodes that belong to a loop, leaving the rest alone', () => {
    const cycles = findCycles([
      { key: 'a-b', from: 'a', to: 'b' }, { key: 'b-c', from: 'b', to: 'c' }, { key: 'c-a', from: 'c', to: 'a' },
      { key: 'c-d', from: 'c', to: 'd' }, { key: 'd-e', from: 'd', to: 'e' },
    ]);
    expect([...cycles.edges].sort()).toEqual(['a-b', 'b-c', 'c-a']);
    expect([...cycles.nodes].sort()).toEqual(['a', 'b', 'c']);
  });

  it('treats a self loop and a two-node ping-pong as cycles', () => {
    const cycles = findCycles([{ key: 'x-x', from: 'x', to: 'x' }, { key: 'p-q', from: 'p', to: 'q' }, { key: 'q-p', from: 'q', to: 'p' }, { key: 'q-r', from: 'q', to: 'r' }]);
    expect([...cycles.edges].sort()).toEqual(['p-q', 'q-p', 'x-x']);
    expect(cycles.nodes.has('r')).toBe(false);
  });
});
