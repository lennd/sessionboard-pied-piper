import type { Node } from '@xyflow/react';
import { absolutePosition, applyPositions, clearPositions, loadPositions, savePositions } from '../../src/workspace/canvas/positions';

const nodes: Node[] = [
  { id: 'group', type: 'group-box', position: { x: 100, y: 50 }, data: {}, draggable: false },
  { id: 'a', type: 'piece', position: { x: 10, y: 20 }, data: {}, parentId: 'group', draggable: false },
  { id: 'b', type: 'piece', position: { x: 300, y: 20 }, data: {}, draggable: false },
];

describe('canvas positions', () => {
  beforeEach(() => localStorage.clear());

  it('makes every node draggable and applies moved positions', () => {
    const moved = applyPositions(nodes, { a: { x: 40, y: 60 } });
    expect(moved.every((n) => n.draggable)).toBe(true);
    expect(moved.find((n) => n.id === 'a')!.position).toEqual({ x: 40, y: 60 });
    expect(moved.find((n) => n.id === 'b')!.position).toEqual({ x: 300, y: 20 });
  });

  it('computes absolute positions through parent groups', () => {
    const moved = applyPositions(nodes, { group: { x: 0, y: 0 } });
    expect(absolutePosition(moved, 'a')).toEqual({ x: 10, y: 20 });
    expect(absolutePosition(nodes, 'a')).toEqual({ x: 110, y: 70 });
    expect(absolutePosition(nodes, 'missing')).toBeNull();
  });

  it('remembers positions per scene and can forget them', () => {
    savePositions('scene-1', { a: { x: 1, y: 2 } });
    expect(loadPositions('scene-1')).toEqual({ a: { x: 1, y: 2 } });
    expect(loadPositions('scene-2')).toEqual({});
    clearPositions('scene-1');
    expect(loadPositions('scene-1')).toEqual({});
    localStorage.setItem('rdi.positions.bad', '{not json');
    expect(loadPositions('bad')).toEqual({});
  });
});
