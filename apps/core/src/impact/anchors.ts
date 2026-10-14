import type { Scene, SceneRisk } from '@rdi/scene';

export type DiffLines = Map<string, { added: number[]; context: number[] }>;
export type RiskAnchor = { path: string; line: number } | null;
export type AnchoredRisk = { risk: SceneRisk; anchor: RiskAnchor; pieces: string[] };

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/** New-side line numbers present in a unified diff, per file: the only lines GitHub accepts for inline review comments. */
export const diffLines = (diff: string): DiffLines => {
  const files: DiffLines = new Map();
  let current: { added: number[]; context: number[] } | null = null;
  let line = 0;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const path = /\sb\/(.+)$/.exec(raw)?.[1] ?? '';
      current = { added: [], context: [] };
      files.set(path, current);
      continue;
    }
    const hunk = HUNK.exec(raw);
    if (hunk) {
      line = Number(hunk[1]);
      continue;
    }
    if (!current || raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) current.added.push(line++);
    else if (raw.startsWith('-')) continue;
    else if (raw.startsWith(' ') || raw === '') line++;
  }
  for (const [, value] of files) value.context = value.context.length ? value.context : [];
  return files;
};

const normalize = (path: string) => path.replace(/^\.\//, '');
const inRange = (lines: number[], start: number, end: number) => lines.find((l) => l >= start && l <= end);

/** Anchors each risk to the first changed line of the piece it points at; falls back to the first changed line of the piece's file. */
export const anchorRisks = (scene: Scene, lines: DiffLines): AnchoredRisk[] => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  return scene.risks.map((risk) => {
    let anchor: RiskAnchor = null;
    for (const nodeId of risk.nodeIds) {
      const node = byId.get(nodeId);
      if (!node?.code?.path) continue;
      const file = lines.get(normalize(node.code.path));
      if (!file) continue;
      const exact = inRange(file.added, node.code.startLine, node.code.endLine);
      const line = exact ?? file.added[0];
      if (line !== undefined) {
        anchor = { path: normalize(node.code.path), line };
        if (exact !== undefined) break;
      }
    }
    return { risk, anchor, pieces: risk.nodeIds.map((id) => byId.get(id)?.label ?? id) };
  });
};

const SEVERITY_GLYPH: Record<string, string> = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' };
export const SIGNATURE = '_Posted from Pied Piper_';
const LOGO_SIZE = 18;

/** Signature line with the mark when a public logo URL is known. */
export const signature = (logoUrl: string | null): string =>
  logoUrl ? `<img src="${logoUrl}" width="${LOGO_SIZE}" height="${LOGO_SIZE}" alt="Pied Piper" align="absmiddle"> _Reviewed with Pied Piper_` : SIGNATURE;

export type Evidence = { logoUrl: string | null; images: Map<string, string> };
export const NO_EVIDENCE: Evidence = { logoUrl: null, images: new Map() };

export const commentBody = (entry: AnchoredRisk, evidence: Evidence = NO_EVIDENCE): string =>
  [
    `**${SEVERITY_GLYPH[entry.risk.severity] ?? '•'} ${entry.risk.severity} · ${entry.risk.category}: ${entry.risk.title}**`,
    entry.risk.explanation,
    ...(entry.risk.mitigation ? [`**Mitigation:** ${entry.risk.mitigation}`] : []),
    ...(entry.pieces.length ? [`Pieces: ${entry.pieces.join(', ')}`] : []),
    ...(evidence.images.has(entry.risk.id) ? [`![${entry.pieces.join(', ') || 'Impact'} on the system map](${evidence.images.get(entry.risk.id)})`] : []),
    signature(evidence.logoUrl),
  ].join('\n\n');

/** Splits the selected risks into inline comments and a summary for the ones the diff cannot anchor. */
export const buildReview = (entries: AnchoredRisk[], intro: string | null, evidence: Evidence = NO_EVIDENCE) => {
  const inline = entries.filter((e): e is AnchoredRisk & { anchor: { path: string; line: number } } => e.anchor !== null);
  const unanchored = entries.filter((e) => e.anchor === null);
  const plain = (e: AnchoredRisk) => commentBody(e, { logoUrl: null, images: NO_EVIDENCE.images }).replace(SIGNATURE, '').trim().replace(/\n\n/g, ' — ');
  const body = [
    intro ?? `Impact review: ${entries.length} risk${entries.length === 1 ? '' : 's'} found by Pied Piper.`,
    ...unanchored.map((e) => `- ${plain(e)}${evidence.images.has(e.risk.id) ? `\n\n  ![${e.pieces.join(', ') || 'Impact'} on the system map](${evidence.images.get(e.risk.id)})` : ''}`),
    signature(evidence.logoUrl),
  ].join('\n\n');
  return { body, comments: inline.map((e) => ({ path: e.anchor.path, line: e.anchor.line, side: 'RIGHT' as const, body: commentBody(e, evidence) })) };
};
