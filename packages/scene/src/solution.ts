import { z } from 'zod';
import { SEVERITIES, type Scene, type Severity } from './schema';
import { validateScene } from './validate';

export const TASK_STATUSES = ['todo', 'in_progress', 'done', 'blocked'] as const;
export const SOLUTION_STATUSES = ['draft', 'in_progress', 'done', 'archived'] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export type SolutionStatus = (typeof SOLUTION_STATUSES)[number];

const MAX_ID = 120;
const MAX_TITLE = 200;
const MAX_TEXT = 4000;
const MAX_TASKS = 60;
const MAX_RISKS = 40;

const taskSchema = z.object({
  id: z.string().min(1).max(MAX_ID),
  title: z.string().min(1).max(MAX_TITLE),
  description: z.string().min(1).max(MAX_TEXT).optional(),
  nodeRefs: z.array(z.string().min(1).max(MAX_ID)).max(40).default([]),
  acceptance: z.array(z.string().min(1).max(MAX_TEXT)).max(20).default([]),
  dependsOn: z.array(z.string().min(1).max(MAX_ID)).max(20).default([]),
});
const riskSchema = z.object({ title: z.string().min(1).max(MAX_TITLE), severity: z.enum(SEVERITIES), mitigation: z.string().min(1).max(MAX_TEXT).optional() });
const draftSchema = z.object({
  summary: z.string().min(1).max(MAX_TEXT),
  sceneCurrent: z.unknown().optional(),
  sceneProposed: z.unknown().optional(),
  plan: z.array(taskSchema).max(MAX_TASKS).default([]),
  risks: z.array(riskSchema).max(MAX_RISKS).default([]),
});

export type SolutionTask = z.infer<typeof taskSchema>;
export type SolutionRisk = { title: string; severity: Severity; mitigation?: string };
export type SolutionDraft = { summary: string; sceneCurrent: Scene | null; sceneProposed: Scene | null; plan: SolutionTask[]; risks: SolutionRisk[] };

export const solutionDraftInputSchema = draftSchema;

export const validateSolutionDraft = (input: unknown): { ok: true; draft: SolutionDraft } | { ok: false; errors: string[] } => {
  const parsed = draftSchema.safeParse(input);
  if (!parsed.success) return { ok: false, errors: parsed.error.issues.map((i) => `${i.path.join('.') || 'draft'}: ${i.message}`) };
  const errors: string[] = [];
  const scenes: Record<'sceneCurrent' | 'sceneProposed', Scene | null> = { sceneCurrent: null, sceneProposed: null };
  for (const key of ['sceneCurrent', 'sceneProposed'] as const) {
    const raw = parsed.data[key];
    if (raw === undefined || raw === null) continue;
    const result = validateScene(raw);
    if (result.ok) scenes[key] = result.scene;
    else errors.push(...result.errors.map((e) => `${key}: ${e}`));
  }
  if (errors.length > 0) return { ok: false, errors };
  const { plan, risks, summary } = parsed.data;
  if (!scenes.sceneCurrent && !scenes.sceneProposed && plan.length === 0) return { ok: false, errors: ['a solution needs a scene or a plan'] };
  const pieces = new Set([...(scenes.sceneCurrent?.nodes ?? []), ...(scenes.sceneProposed?.nodes ?? [])].map((n) => n.id));
  const taskIds = new Set<string>();
  for (const task of plan) {
    if (taskIds.has(task.id)) errors.push(`plan: duplicate task id "${task.id}"`);
    taskIds.add(task.id);
  }
  for (const task of plan) {
    for (const ref of task.nodeRefs) if (!pieces.has(ref)) errors.push(`plan.${task.id}: nodeRefs "${ref}" is not a piece of the current or proposed scene`);
    for (const dep of task.dependsOn) if (!taskIds.has(dep)) errors.push(`plan.${task.id}: dependsOn "${dep}" is not a task of this plan`);
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, draft: { summary, ...scenes, plan, risks } };
};
