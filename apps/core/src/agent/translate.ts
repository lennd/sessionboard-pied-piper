import type { Scene, Step } from '@rdi/scene';
import type { Config } from '../config';
import { TRANSLATE_MARKER } from './prompt';
import { runAgent, type QueryFn, type RunUsage } from './sdkRunner';

export const MAX_TRANSLATE_ATTEMPTS = 2;
export const TRANSLATE_INSTRUCTIONS = [
  'Translate every human-readable text of the scene below (title, summary, labels, kinds, summaries, details, narration, annotations, payload text that is prose, risk titles, explanations and mitigations, scale notes and advice) into the target language.',
  'Keep every id, role, parent, repo, edge endpoint and kind, step order and structure, graphRef, code reference and JSON payload value exactly as they are. Set language to the target language tag.',
  'Return the result by calling emit_scene once with the complete translated scene. Do not read any files.',
].join('\n');

export class TranslateError extends Error {}

const stepShape = (steps: Step[]): unknown => steps.map((s) => [s.id, s.focus, s.travel?.edgeId ?? null, s.expand ?? null, stepShape(s.substeps)]);

export const sameStructure = (a: Scene, b: Scene): string[] => {
  const checks: [string, unknown, unknown][] = [
    ['nodes', a.nodes.map((n) => [n.id, n.role, n.parent ?? null]), b.nodes.map((n) => [n.id, n.role, n.parent ?? null])],
    ['edges', a.edges.map((e) => [e.id, e.from, e.to, e.kind]), b.edges.map((e) => [e.id, e.from, e.to, e.kind])],
    ['steps', stepShape(a.steps), stepShape(b.steps)],
    ['risks', a.risks.map((r) => [r.id, r.category, r.severity, r.nodeIds]), b.risks.map((r) => [r.id, r.category, r.severity, r.nodeIds])],
    ['id', a.id, b.id],
  ];
  return checks.filter(([, x, y]) => JSON.stringify(x) !== JSON.stringify(y)).map(([name]) => `${name} differ from the original`);
};

export const translatePrompt = (scene: Scene, language: string, problems: string[] = []): string =>
  [`${TRANSLATE_MARKER} ${language}`, ...(problems.length > 0 ? [`Fix these problems of your previous attempt: ${problems.join('; ')}`] : []), TRANSLATE_INSTRUCTIONS, JSON.stringify(scene)].join('\n');

export const translateScene = async (
  queryFn: QueryFn,
  input: { cwd: string; scene: Scene; language: string; agent: Config['agent']; signal?: AbortSignal },
): Promise<{ scene: Scene; usage: RunUsage }> => {
  const usage: RunUsage = { input: 0, output: 0, costUsd: 0 };
  let problems: string[] = [];
  for (let attempt = 0; attempt < MAX_TRANSLATE_ATTEMPTS; attempt++) {
    const result = await runAgent(queryFn, {
      cwd: input.cwd, mode: 'translate', prompt: translatePrompt(input.scene, input.language, problems), agent: input.agent, signal: input.signal,
      ctx: { upsertSolution: async () => { throw new Error('not available while translating'); } },
      emit: () => undefined,
    });
    usage.input += result.usage.input;
    usage.output += result.usage.output;
    usage.costUsd += result.usage.costUsd;
    if (result.stop === 'error') throw new TranslateError(result.errorCode ?? 'llm_error');
    const scene = result.scenes.at(-1);
    if (!scene) {
      problems = ['emit_scene was not called'];
      continue;
    }
    problems = [...sameStructure(input.scene, scene), ...(scene.language === input.language ? [] : [`language must be "${input.language}"`])];
    if (problems.length === 0) return { scene, usage };
  }
  throw new TranslateError(`translation failed after ${MAX_TRANSLATE_ATTEMPTS} attempts`);
};
