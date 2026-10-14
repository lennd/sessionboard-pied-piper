import type { Scene, SceneRisk } from '@rdi/scene';
import type { RiskAnchor } from './pullsApi';

export type VerdictStatus = 'pass' | 'warn' | 'fail';
export type VerdictAction = { riskId: string; title: string; what: string; where: string | null; severity: SceneRisk['severity']; rule: boolean };
export type Verdict = { status: VerdictStatus; blockers: VerdictAction[]; warnings: VerdictAction[]; total: number };

const BLOCKING = new Set<SceneRisk['severity']>(['critical', 'high']);
const RULE_PREFIX = /^rule:/i;

/** `path:start-end` (or `path:line`) of the changed code a risk is anchored to. */
export const whereOf = (anchor: NonNullable<RiskAnchor['anchor']>): string => `${anchor.path}:${anchor.startLine !== undefined ? `${anchor.startLine}-` : ''}${anchor.line}`;

const actionOf = (risk: SceneRisk, anchors: Map<string, RiskAnchor>): VerdictAction => {
  const anchor = anchors.get(risk.id)?.anchor ?? null;
  return { riskId: risk.id, title: risk.title, what: risk.mitigation ?? risk.explanation, where: anchor ? whereOf(anchor) : null, severity: risk.severity, rule: RULE_PREFIX.test(risk.title) };
};

/** Deterministic verdict from the explained impact scene: a broken team rule or a high/critical risk blocks; medium risks only warn. */
export const verdictOf = (scene: Scene, anchors: RiskAnchor[] = []): Verdict => {
  const byId = new Map(anchors.map((a) => [a.id, a]));
  const blockers = scene.risks.filter((r) => BLOCKING.has(r.severity) || RULE_PREFIX.test(r.title)).map((r) => actionOf(r, byId));
  const warnings = scene.risks.filter((r) => r.severity === 'medium' && !RULE_PREFIX.test(r.title)).map((r) => actionOf(r, byId));
  return { status: blockers.length > 0 ? 'fail' : warnings.length > 0 ? 'warn' : 'pass', blockers, warnings, total: scene.risks.length };
};
