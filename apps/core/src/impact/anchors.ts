import type { Scene, SceneRisk } from '@rdi/scene';

export type DiffLines = Map<string, { added: number[]; hunkOf: Map<number, number> }>;
/** Where a risk lands in the pull request: one line, or a range (startLine..line) inside the same hunk. */
export type RiskAnchor = { path: string; line: number; startLine?: number } | null;
export type AnchoredRisk = { risk: SceneRisk; anchor: RiskAnchor; pieces: string[] };
type CodeRange = { path: string; startLine: number; endLine: number };

const HUNK = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/;
/** Longest range an inline comment highlights when the risk only points at a whole piece. */
const MAX_SPAN = 40;

/** New-side line numbers of the added lines in a unified diff, per file, with the hunk each one belongs to: the only lines GitHub accepts for inline review comments. */
export const diffLines = (diff: string): DiffLines => {
  const files: DiffLines = new Map();
  let current: { added: number[]; hunkOf: Map<number, number> } | null = null;
  let line = 0;
  let hunk = -1;
  for (const raw of diff.split('\n')) {
    if (raw.startsWith('diff --git ')) {
      const path = /\sb\/(.+)$/.exec(raw)?.[1] ?? '';
      current = { added: [], hunkOf: new Map() };
      files.set(path, current);
      hunk = -1;
      continue;
    }
    const match = HUNK.exec(raw);
    if (match) {
      line = Number(match[1]);
      hunk += 1;
      continue;
    }
    if (!current || raw.startsWith('---') || raw.startsWith('+++') || raw.startsWith('\\')) continue;
    if (raw.startsWith('+')) {
      current.added.push(line);
      current.hunkOf.set(line, hunk);
      line += 1;
    } else if (raw.startsWith('-')) continue;
    else if (raw.startsWith(' ') || raw === '') line += 1;
  }
  return files;
};

const normalize = (path: string) => path.replace(/^\.\//, '');

/** The added lines of one range that GitHub can highlight together: from the first changed line, within its hunk, at most `span` lines long. */
const spanWithin = (file: { added: number[]; hunkOf: Map<number, number> }, range: CodeRange, span: number): { startLine: number; line: number } | null => {
  const inside = file.added.filter((l) => l >= range.startLine && l <= range.endLine);
  const first = inside[0];
  if (first === undefined) return null;
  const hunk = file.hunkOf.get(first);
  const last = inside.filter((l) => file.hunkOf.get(l) === hunk && l < first + span).at(-1) ?? first;
  return { startLine: first, line: last };
};

const anchorOf = (path: string, span: { startLine: number; line: number }): RiskAnchor => (span.line > span.startLine ? { path, startLine: span.startLine, line: span.line } : { path, line: span.line });

/** Anchors each risk to the changed lines it points at: its own code range first, then the pieces it names; falls back to the first changed line of the piece's file. */
export const anchorRisks = (scene: Scene, lines: DiffLines): AnchoredRisk[] => {
  const byId = new Map(scene.nodes.map((n) => [n.id, n]));
  return scene.risks.map((risk) => {
    let anchor: RiskAnchor = null;
    const own = risk.code ? lines.get(normalize(risk.code.path)) : undefined;
    const exactOwn = own && risk.code ? spanWithin(own, risk.code, Number.MAX_SAFE_INTEGER) : null;
    if (exactOwn && risk.code) return { risk, anchor: anchorOf(normalize(risk.code.path), exactOwn), pieces: risk.nodeIds.map((id) => byId.get(id)?.label ?? id) };
    for (const nodeId of risk.nodeIds) {
      const node = byId.get(nodeId);
      if (!node?.code?.path) continue;
      const path = normalize(node.code.path);
      const file = lines.get(path);
      if (!file) continue;
      const exact = spanWithin(file, node.code, MAX_SPAN);
      if (exact) {
        anchor = anchorOf(path, exact);
        break;
      }
      const line = file.added[0];
      if (line !== undefined && !anchor) anchor = { path, line };
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

/** `path:start-end` of the code a risk points at, for readers of the summary who have no inline anchor. */
export const location = (risk: SceneRisk): string | null => (risk.code ? `\`${risk.code.path}:${risk.code.startLine}${risk.code.endLine > risk.code.startLine ? `-${risk.code.endLine}` : ''}\`` : null);

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
  const inline = entries.filter((e): e is AnchoredRisk & { anchor: NonNullable<RiskAnchor> } => e.anchor !== null);
  const unanchored = entries.filter((e) => e.anchor === null);
  const plain = (e: AnchoredRisk) => {
    const text = commentBody(e, { logoUrl: null, images: NO_EVIDENCE.images }).replace(SIGNATURE, '').trim().replace(/\n\n/g, ' — ');
    const where = location(e.risk);
    return where ? `${text} — at ${where}` : text;
  };
  const body = [
    intro ?? `Impact review: ${entries.length} risk${entries.length === 1 ? '' : 's'} found by Pied Piper.`,
    ...unanchored.map((e) => `- ${plain(e)}${evidence.images.has(e.risk.id) ? `\n\n  ![${e.pieces.join(', ') || 'Impact'} on the system map](${evidence.images.get(e.risk.id)})` : ''}`),
    signature(evidence.logoUrl),
  ].join('\n\n');
  return {
    body,
    comments: inline.map((e) => ({
      path: e.anchor.path,
      line: e.anchor.line,
      side: 'RIGHT' as const,
      ...(e.anchor.startLine !== undefined ? { start_line: e.anchor.startLine, start_side: 'RIGHT' as const } : {}),
      body: commentBody(e, evidence),
    })),
  };
};
