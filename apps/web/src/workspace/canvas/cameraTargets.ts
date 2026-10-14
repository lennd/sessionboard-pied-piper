import type { ProjectedEdges, SceneRisk, VisibleModel } from '@rdi/scene';
import type { Mode } from '../engine/explorerState';
import type { Frame } from '../engine/frame';

export type CameraShot = { key: string; nodeIds: string[] };

/**
 * What the camera should frame: during a walkthrough the step's pieces plus both ends of the edge being travelled;
 * in risks mode the pieces a (hovered or selected) risk points at. An empty list means "show everything".
 */
export const cameraShot = (input: { mode: Mode; frame: Frame; projected: ProjectedEdges; model: VisibleModel; risk: SceneRisk | null; hoverRisk: SceneRisk | null }): CameraShot => {
  const { mode, frame, projected, model } = input;
  const project = (id: string) => model.representative.get(id) ?? id;
  if (mode === 'risks') {
    const risk = input.hoverRisk ?? input.risk;
    if (!risk) return { key: 'risks:all', nodeIds: [] };
    return { key: `risk:${risk.id}`, nodeIds: [...new Set(risk.nodeIds.map(project))] };
  }
  if (mode === 'walkthrough' && frame.flat) {
    const ids = new Set<string>([...frame.focused, ...frame.highlighted]);
    const edge = frame.active ? projected.edges.find((e) => e.key === frame.active!.key) : undefined;
    if (edge) {
      ids.add(edge.from);
      ids.add(edge.to);
    }
    return { key: `step:${frame.flat.step.id}:${frame.index}`, nodeIds: [...ids] };
  }
  return { key: `${mode}:all`, nodeIds: [] };
};
