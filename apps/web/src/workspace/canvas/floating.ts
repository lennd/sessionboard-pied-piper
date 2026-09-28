export type Point = { x: number; y: number };
export type Rect = { x: number; y: number; width: number; height: number };

export const rectCenter = (r: Rect): Point => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

export const borderIntersection = (r: Rect, toward: Point): Point => {
  const c = rectCenter(r);
  const dx = toward.x - c.x;
  const dy = toward.y - c.y;
  if (dx === 0 && dy === 0) return c;
  const scaleX = dx === 0 ? Number.POSITIVE_INFINITY : r.width / 2 / Math.abs(dx);
  const scaleY = dy === 0 ? Number.POSITIVE_INFINITY : r.height / 2 / Math.abs(dy);
  const scale = Math.min(scaleX, scaleY);
  return { x: c.x + dx * scale, y: c.y + dy * scale };
};

export const floatingEdgePoints = (source: Rect, target: Rect) => {
  const s = borderIntersection(source, rectCenter(target));
  const t = borderIntersection(target, rectCenter(source));
  return { sx: s.x, sy: s.y, tx: t.x, ty: t.y };
};

export const pointAlong = (sx: number, sy: number, tx: number, ty: number, t: number): Point => ({ x: sx + (tx - sx) * t, y: sy + (ty - sy) * t });
