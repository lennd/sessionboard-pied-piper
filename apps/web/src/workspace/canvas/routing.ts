import type { Point } from './floating';

const CORNER = 10;

/** SVG path through the points with rounded corners, so orthogonal routes read as one flowing line. */
export const roundedPath = (points: Point[], radius = CORNER): string => {
  if (points.length === 0) return '';
  if (points.length < 3) return points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
  const parts = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let i = 1; i < points.length - 1; i += 1) {
    const prev = points[i - 1]!;
    const corner = points[i]!;
    const next = points[i + 1]!;
    const inLen = Math.hypot(corner.x - prev.x, corner.y - prev.y);
    const outLen = Math.hypot(next.x - corner.x, next.y - corner.y);
    const r = Math.min(radius, inLen / 2, outLen / 2);
    if (r <= 0) {
      parts.push(`L ${corner.x} ${corner.y}`);
      continue;
    }
    const a = { x: corner.x - ((corner.x - prev.x) / inLen) * r, y: corner.y - ((corner.y - prev.y) / inLen) * r };
    const b = { x: corner.x + ((next.x - corner.x) / outLen) * r, y: corner.y + ((next.y - corner.y) / outLen) * r };
    parts.push(`L ${a.x} ${a.y}`, `Q ${corner.x} ${corner.y} ${b.x} ${b.y}`);
  }
  const last = points.at(-1)!;
  parts.push(`L ${last.x} ${last.y}`);
  return parts.join(' ');
};

const lengths = (points: Point[]): number[] => points.slice(1).map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));

/** Point at fraction `t` of the total length of the polyline. */
export const pointAlongPolyline = (points: Point[], t: number): Point => {
  if (points.length === 0) return { x: 0, y: 0 };
  if (points.length === 1) return points[0]!;
  const segs = lengths(points);
  const total = segs.reduce((a, b) => a + b, 0);
  let remaining = Math.min(Math.max(t, 0), 1) * total;
  for (let i = 0; i < segs.length; i += 1) {
    const len = segs[i]!;
    if (remaining <= len || i === segs.length - 1) {
      const f = len === 0 ? 0 : remaining / len;
      const a = points[i]!;
      const b = points[i + 1]!;
      return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f };
    }
    remaining -= len;
  }
  return points.at(-1)!;
};

/** Where a label sits: the middle of the longest segment, which is the least likely to overlap other lines. */
export const labelAnchor = (points: Point[]): Point => {
  if (points.length < 2) return points[0] ?? { x: 0, y: 0 };
  const segs = lengths(points);
  let best = 0;
  segs.forEach((len, i) => { if (len > segs[best]!) best = i; });
  const a = points[best]!;
  const b = points[best + 1]!;
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
};
