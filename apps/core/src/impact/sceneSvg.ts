import type { Scene, SceneNode } from '@rdi/scene';

const COLUMN_ORDER = ['actor', 'compute', 'logic', 'channel', 'storage', 'data', 'external'] as const;
const BOX_W = 168;
const BOX_H = 46;
const GAP_X = 72;
const GAP_Y = 22;
const PAD = 28;
const TITLE_H = 40;
const MAX_LABEL = 22;
const GREEN = '#0b6b3f';
const GREEN_DEEP = '#074a2b';
const MINT = '#cdefd9';
const WHITE = '#ffffff';
const CHANGE_COLOR: Record<string, string> = { added: '#7be7a5', modified: '#f5d90a', removed: '#ff5c6c' };

const escape = (text: string) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (text: string) => (text.length <= MAX_LABEL ? text : `${text.slice(0, MAX_LABEL - 1)}…`);

type Placed = { node: SceneNode; x: number; y: number };

/** Deterministic column layout: pieces grouped by role, left to right along the usual flow, top-level pieces only. */
export const layoutColumns = (scene: Scene): Placed[] => {
  const top = scene.nodes.filter((n) => !n.parent);
  const columns = COLUMN_ORDER.map((role) => top.filter((n) => n.role === role)).filter((c) => c.length > 0);
  const tallest = Math.max(1, ...columns.map((c) => c.length));
  return columns.flatMap((column, ci) =>
    column.map((node, ri) => ({ node, x: PAD + ci * (BOX_W + GAP_X), y: PAD + TITLE_H + (tallest - column.length) * ((BOX_H + GAP_Y) / 2) + ri * (BOX_H + GAP_Y) })),
  );
};

/** Renders the scene as a static SVG in the brand colours, with `highlight` pieces drawn in white and everything else dimmed. */
export const renderSceneSvg = (scene: Scene, options: { highlight: string[]; caption?: string }): string => {
  const placed = layoutColumns(scene);
  const byId = new Map(placed.map((p) => [p.node.id, p]));
  const resolve = (id: string): Placed | undefined => byId.get(id) ?? byId.get(scene.nodes.find((n) => n.id === id)?.parent ?? '');
  const highlight = new Set(options.highlight);
  const width = Math.max(...placed.map((p) => p.x + BOX_W), BOX_W) + PAD;
  const height = Math.max(...placed.map((p) => p.y + BOX_H), BOX_H) + PAD;
  const edges = scene.edges
    .map((e) => ({ e, from: resolve(e.from), to: resolve(e.to) }))
    .filter((x): x is { e: Scene['edges'][number]; from: Placed; to: Placed } => Boolean(x.from && x.to && x.from !== x.to))
    .map(({ e, from, to }) => {
      const hot = highlight.has(e.from) || highlight.has(e.to);
      const x1 = from.x + BOX_W / 2, y1 = from.y + BOX_H / 2, x2 = to.x + BOX_W / 2, y2 = to.y + BOX_H / 2;
      return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${hot ? WHITE : MINT}" stroke-opacity="${hot ? 0.95 : 0.35}" stroke-width="${hot ? 2.5 : 1.5}" ${e.kind === 'async' ? 'stroke-dasharray="6 6"' : ''} marker-end="url(#arrow)"/>`;
    });
  const boxes = placed.map(({ node, x, y }) => {
    const hot = highlight.has(node.id);
    const change = node.change ? CHANGE_COLOR[node.change] : null;
    const fill = hot ? WHITE : 'rgba(255,255,255,0.08)';
    const stroke = hot ? WHITE : change ?? 'rgba(255,255,255,0.35)';
    const text = hot ? GREEN_DEEP : WHITE;
    return [
      `<g opacity="${hot || change ? 1 : 0.7}">`,
      `<rect x="${x}" y="${y}" width="${BOX_W}" height="${BOX_H}" rx="10" fill="${fill}" stroke="${stroke}" stroke-width="${hot ? 3 : 1.5}"/>`,
      hot ? `<rect x="${x - 5}" y="${y - 5}" width="${BOX_W + 10}" height="${BOX_H + 10}" rx="14" fill="none" stroke="${WHITE}" stroke-opacity="0.5" stroke-width="2"/>` : '',
      `<text x="${x + 12}" y="${y + 20}" fill="${text}" font-family="Inter, system-ui, sans-serif" font-size="13" font-weight="700">${escape(clip(node.label))}</text>`,
      `<text x="${x + 12}" y="${y + 36}" fill="${hot ? GREEN : MINT}" font-family="Inter, system-ui, sans-serif" font-size="11">${escape(clip(node.kind))}${node.change ? ` · ${node.change}` : ''}</text>`,
      '</g>',
    ].join('');
  });
  const caption = options.caption ? `<text x="${PAD}" y="${PAD + 2}" fill="${MINT}" font-family="Inter, system-ui, sans-serif" font-size="12">${escape(clip(options.caption))}</text>` : '';
  return [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`,
    `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0 0 L10 5 L0 10 Z" fill="${MINT}"/></marker></defs>`,
    `<rect width="${width}" height="${height}" rx="16" fill="${GREEN}"/>`,
    `<text x="${PAD}" y="${PAD + 18}" fill="${WHITE}" font-family="'Iowan Old Style', Palatino, Georgia, serif" font-size="18" font-weight="600">${escape(scene.title)}</text>`,
    caption ? caption.replace(`y="${PAD + 2}"`, `y="${PAD + 34}"`) : '',
    ...edges,
    ...boxes,
    '</svg>',
  ].join('');
};
