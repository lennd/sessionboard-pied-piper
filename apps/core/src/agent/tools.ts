import { sceneSchema, solutionDraftInputSchema, validateScene, validateSolutionDraft, type Scene } from '@rdi/scene';
import { z } from 'zod';
import { SolutionError } from '../solutions/service';
import { repairScene } from './repairScene';

export type ToolContext = {
  upsertSolution(input: { solutionId?: string; title: string; draft: Record<string, unknown> }): Promise<{ id: string; n: number; title: string }>;
};
export type ToolOutcome = { content: string; isError?: boolean; scene?: Scene; solution?: { id: string; n: number; title: string }; summary: string };

export const TOOL_NAMES = ['emit_scene', 'upsert_solution'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];
export const MCP_SERVER_NAME = 'rdi';
export const mcpToolName = (name: ToolName) => `mcp__${MCP_SERVER_NAME}__${name}`;
const MAX_ERRORS = 25;

const upsertInput = solutionDraftInputSchema.extend({ solutionId: z.string().uuid().optional(), title: z.string().trim().min(1).max(200) });

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  emit_scene: 'Render an animated Scene v2 on the canvas. The input is the complete scene. Returns validation errors if the scene is invalid; fix them and call again.',
  upsert_solution:
    'Save a proposed change as a versioned Solution: a short summary, the current and proposed scenes (Scene v2, same rules as emit_scene), an ordered task plan whose nodeRefs are node ids of those scenes, and risks. Pass solutionId to add a new version to an existing solution. Use it when the user wants to change or build something.',
};

/** Zod raw shapes handed to the Agent SDK so the model sees the full input schema of each tool. */
export const TOOL_SHAPES = { emit_scene: sceneSchema.shape, upsert_solution: upsertInput.shape } as const;

export const sceneInputSchema = (() => {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(sceneSchema, { io: 'input' }) as Record<string, unknown>;
  return rest;
})();

const invalid = (name: string, error: z.ZodError): ToolOutcome => ({
  content: `Invalid input for ${name}: ${error.issues.map((i) => `${i.path.join('.') || 'input'}: ${i.message}`).join('; ')}`,
  isError: true,
  summary: `${name} (invalid input)`,
});

const emitScene = (input: unknown): ToolOutcome => {
  let result = validateScene(input);
  let fixes: string[] = [];
  if (!result.ok) {
    const repaired = repairScene(input);
    const second = validateScene(repaired.scene);
    if (second.ok) {
      result = second;
      fixes = repaired.fixes;
    }
  }
  if (!result.ok) {
    return { content: `The scene is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'emit_scene (invalid)' };
  }
  const { scene } = result;
  const note = fixes.length > 0 ? ` Auto-fixed: ${fixes.join('; ')}.` : '';
  return { content: `Scene "${scene.title}" rendered with ${scene.nodes.length} pieces and ${scene.steps.length} steps.${note}`, scene, summary: `emit_scene "${scene.title}"` };
};

const upsertSolution = async (input: z.infer<typeof upsertInput>, ctx: ToolContext): Promise<ToolOutcome> => {
  const { solutionId, title, ...draft } = input;
  const result = validateSolutionDraft(draft);
  if (!result.ok) return { content: `The solution is invalid:\n${result.errors.slice(0, MAX_ERRORS).join('\n')}`, isError: true, summary: 'upsert_solution (invalid)' };
  try {
    const saved = await ctx.upsertSolution({ solutionId, title, draft });
    return { content: `Solution "${saved.title}" saved as version ${saved.n} (id ${saved.id}).`, solution: saved, summary: `upsert_solution "${saved.title}" v${saved.n}` };
  } catch (error) {
    if (error instanceof SolutionError) return { content: `Could not save the solution: ${error.code} ${error.errors.join('; ')}`.trim(), isError: true, summary: 'upsert_solution (rejected)' };
    throw error;
  }
};

export const executeTool = async (name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> => {
  try {
    return await runTool(name, input, ctx);
  } catch (error) {
    return { content: `Tool ${name} failed: ${error instanceof Error ? error.message : String(error)}`, isError: true, summary: `${name} (failed)` };
  }
};

const runTool = async (name: string, input: unknown, ctx: ToolContext): Promise<ToolOutcome> => {
  switch (name) {
    case 'emit_scene':
      return emitScene(input);
    case 'upsert_solution': {
      const parsed = upsertInput.safeParse(input);
      return parsed.success ? upsertSolution(parsed.data, ctx) : invalid(name, parsed.error);
    }
    default:
      return { content: `Unknown tool "${name}".`, isError: true, summary: `${name} (unknown)` };
  }
};
