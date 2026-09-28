import { descendantsOf, SCALE_STATUSES, SEVERITIES, type ScaleStatus, type Scene, type SceneIndex, type SceneNode, type SceneRisk, type Severity } from '@rdi/scene/v2';

export const severityRank = (s: Severity): number => SEVERITIES.indexOf(s);
export const statusRank = (s: ScaleStatus): number => SCALE_STATUSES.indexOf(s);

export const risksByNode = (scene: Scene): Map<string, SceneRisk[]> => {
  const result = new Map<string, SceneRisk[]>();
  scene.risks.forEach((risk) => risk.nodeIds.forEach((id) => result.set(id, [...(result.get(id) ?? []), risk])));
  return result;
};

export const maxSeverity = (risks: SceneRisk[]): Severity | undefined =>
  risks.reduce<Severity | undefined>((max, r) => (max === undefined || severityRank(r.severity) > severityRank(max) ? r.severity : max), undefined);

export const worstScale = (node: SceneNode): ScaleStatus | undefined => {
  if (!node.scale) return undefined;
  return [node.scale.low.status, node.scale.medium.status, node.scale.high.status].reduce((a, b) => (statusRank(b) > statusRank(a) ? b : a));
};

export const aggregateSeverity = (index: SceneIndex, byNode: Map<string, SceneRisk[]>, ids: string[]): Severity | undefined =>
  maxSeverity(ids.flatMap((id) => [id, ...descendantsOf(index, id)]).flatMap((id) => byNode.get(id) ?? []));
