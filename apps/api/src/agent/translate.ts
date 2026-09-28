import type Anthropic from '@anthropic-ai/sdk';
import { validateScene, type Scene, type Step } from '@rdi/scene';
import { TRANSLATE_MARKER, type LlmClient } from './llm';
import { toolDefinitions } from './tools';

export const MAX_TRANSLATE_ATTEMPTS = 3;
export const TRANSLATE_SYSTEM = [
  'You translate Repository Designer scenes.',
  'Translate every human-readable text (title, summary, labels, kinds, summaries, details, narration, annotations, payload text that is prose, risk titles, explanations and mitigations, scale notes and advice) into the target language.',
  'Keep every id, role, parent, repo, edge endpoint and kind, step order and structure, graphRef, code reference and JSON payload value exactly as they are. Set language to the target language tag.',
  'Return the result by calling emit_scene once with the complete translated scene.',
].join('\n');

export class TranslateError extends Error {}

const emitSceneTool = toolDefinitions.filter((t) => t.name === 'emit_scene');

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

export const translateScene = async (
  llm: LlmClient,
  scene: Scene,
  language: string,
  options: { usage?: { input: number; output: number }; signal?: AbortSignal } = {},
): Promise<{ scene: Scene; usage: { input: number; output: number } }> => {
  const usage = options.usage ?? { input: 0, output: 0 };
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: `${TRANSLATE_MARKER} ${language}\n\n${JSON.stringify(scene)}` }];
  for (let attempt = 0; attempt < MAX_TRANSLATE_ATTEMPTS; attempt++) {
    const message = await llm.turn({ system: TRANSLATE_SYSTEM, messages, tools: emitSceneTool, signal: options.signal });
    usage.input += message.usage.input_tokens + (message.usage.cache_creation_input_tokens ?? 0) + (message.usage.cache_read_input_tokens ?? 0);
    usage.output += message.usage.output_tokens;
    const call = message.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === 'tool_use' && b.name === 'emit_scene');
    if (!call) {
      messages.push({ role: 'assistant', content: message.content }, { role: 'user', content: 'Call emit_scene with the translated scene.' });
      continue;
    }
    const result = validateScene(call.input);
    const problems = result.ok ? [...sameStructure(scene, result.scene), ...(result.scene.language === language ? [] : [`language must be "${language}"`])] : result.errors;
    if (result.ok && problems.length === 0) return { scene: result.scene, usage };
    messages.push(
      { role: 'assistant', content: message.content },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: call.id, is_error: true, content: `Fix these problems and call emit_scene again:\n${problems.join('\n')}` }] },
    );
  }
  throw new TranslateError(`translation failed after ${MAX_TRANSLATE_ATTEMPTS} attempts`);
};
