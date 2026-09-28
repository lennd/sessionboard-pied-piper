import { borderIntersection, floatingEdgePoints, pointAlong } from '../../src/workspace/canvas/floating';

const box = (x: number, y: number) => ({ x, y, width: 100, height: 50 });

describe('floating edge geometry', () => {
  it('connects horizontal neighbours on their facing borders', () => {
    expect(floatingEdgePoints(box(0, 0), box(200, 0))).toEqual({ sx: 100, sy: 25, tx: 200, ty: 25 });
  });

  it('connects vertical neighbours on top and bottom borders', () => {
    expect(floatingEdgePoints(box(0, 0), box(0, 200))).toEqual({ sx: 50, sy: 50, tx: 50, ty: 200 });
  });

  it('exits through the correct border on diagonals', () => {
    const p = borderIntersection(box(0, 0), { x: 250, y: 105 });
    expect(p.x).toBeCloseTo(100);
    expect(p.y).toBeCloseTo(45);
  });

  it('returns the center when the target point is the center', () => {
    expect(borderIntersection(box(0, 0), { x: 50, y: 25 })).toEqual({ x: 50, y: 25 });
  });

  it('interpolates along a segment', () => {
    expect(pointAlong(0, 0, 100, 50, 0.5)).toEqual({ x: 50, y: 25 });
  });
});
