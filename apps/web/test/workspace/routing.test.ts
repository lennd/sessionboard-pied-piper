// @vitest-environment node
import { labelAnchor, pointAlongPolyline, roundedPath } from '../../src/workspace/canvas/routing';

const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }, { x: 160, y: 50 }];

describe('routing helpers', () => {
  it('rounds the corners of an orthogonal route and keeps straight lines straight', () => {
    expect(roundedPath([{ x: 0, y: 0 }, { x: 10, y: 0 }])).toBe('M 0 0 L 10 0');
    const d = roundedPath(route);
    expect(d.startsWith('M 0 0 L 90 0 Q 100 0 100 10')).toBe(true);
    expect(d.endsWith('L 160 50')).toBe(true);
  });

  it('walks the polyline by length and anchors labels on the longest segment', () => {
    expect(pointAlongPolyline(route, 0)).toEqual({ x: 0, y: 0 });
    expect(pointAlongPolyline(route, 1)).toEqual({ x: 160, y: 50 });
    expect(pointAlongPolyline(route, 0.5)).toEqual({ x: 100, y: 5 });
    expect(labelAnchor(route)).toEqual({ x: 50, y: 0 });
  });
});
