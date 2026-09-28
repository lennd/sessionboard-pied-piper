import { z } from 'zod';

export const ROLES = ['actor', 'compute', 'storage', 'channel', 'external', 'logic', 'data'] as const;
export const EDGE_KINDS = ['sync', 'async', 'read', 'write', 'calls'] as const;
export const SCALE_STATUSES = ['ok', 'strained', 'limit', 'saturated'] as const;
export const SCALE_STRATEGIES = ['horizontal', 'vertical', 'none', 'external', 'n/a'] as const;
export const RISK_CATEGORIES = ['performance', 'security', 'complexity', 'reliability'] as const;
export const SEVERITIES = ['low', 'medium', 'high', 'critical'] as const;
export const CHANGES = ['added', 'modified', 'removed'] as const;
export const PAYLOAD_FORMATS = ['json', 'sql', 'text'] as const;

export type Role = (typeof ROLES)[number];
export type EdgeKind = (typeof EDGE_KINDS)[number];
export type ScaleStatus = (typeof SCALE_STATUSES)[number];
export type ScaleStrategy = (typeof SCALE_STRATEGIES)[number];
export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export type Severity = (typeof SEVERITIES)[number];
export type Change = (typeof CHANGES)[number];

const MAX_LABEL = 120;
const MAX_TEXT = 2000;
const MAX_PAYLOAD = 20_000;
const MAX_CODE = 20_000;
const MAX_PATH = 500;
const MAX_LANGUAGE = 40;
const MAX_NODES = 150;
const MAX_STEPS = 80;
const LANGUAGE_TAG = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/;

const idSchema = z.string().min(1).max(MAX_LABEL);
const labelSchema = z.string().min(1).max(MAX_LABEL);
const textSchema = z.string().min(1).max(MAX_TEXT);

const scaleRowSchema = z.object({ status: z.enum(SCALE_STATUSES), note: textSchema });

const nodeSchema = z.object({
  id: idSchema,
  label: labelSchema,
  role: z.enum(ROLES),
  kind: labelSchema,
  summary: textSchema,
  details: textSchema.optional(),
  parent: idSchema.optional(),
  repo: labelSchema.optional(),
  complexity: z.object({ time: labelSchema, space: labelSchema.optional(), note: textSchema.optional() }).optional(),
  scale: z
    .object({
      low: scaleRowSchema,
      medium: scaleRowSchema,
      high: scaleRowSchema,
      strategy: z.enum(SCALE_STRATEGIES),
      advice: textSchema.optional(),
    })
    .optional(),
  code: z
    .object({
      repo: labelSchema,
      path: z.string().min(1).max(MAX_PATH),
      startLine: z.number().int().positive(),
      endLine: z.number().int().positive(),
      language: z.string().min(1).max(MAX_LANGUAGE),
      snippet: z.string().max(MAX_CODE).optional(),
    })
    .optional(),
  change: z.enum(CHANGES).optional(),
  graphRef: z.string().max(MAX_TEXT).optional(),
});

const edgeSchema = z.object({ id: idSchema, from: idSchema, to: idSchema, kind: z.enum(EDGE_KINDS), label: z.string().max(MAX_LABEL).optional() });

const groupSchema = z.object({ id: idSchema, label: labelSchema, nodeIds: z.array(idSchema).min(1) });

const payloadSchema = z
  .object({
    format: z.enum(PAYLOAD_FORMATS),
    before: z.string().max(MAX_PAYLOAD).optional(),
    after: z.string().max(MAX_PAYLOAD).optional(),
  })
  .refine((p) => p.before !== undefined || p.after !== undefined, { message: 'payload needs before or after' });

export type Payload = z.infer<typeof payloadSchema>;

export interface Step {
  id: string;
  narration: string;
  focus: string[];
  travel?: { edgeId: string; reverse: boolean; payload?: string };
  highlight: string[];
  annotate: { nodeId: string; text: string }[];
  payload?: Payload;
  expand?: string;
  substeps: Step[];
}

export interface StepInput {
  id: string;
  narration: string;
  focus?: string[];
  travel?: { edgeId: string; reverse?: boolean; payload?: string };
  highlight?: string[];
  annotate?: { nodeId: string; text: string }[];
  payload?: Payload;
  expand?: string;
  substeps?: StepInput[];
}

const stepSchema: z.ZodType<Step, StepInput> = z.lazy(() =>
  z.object({
    id: idSchema,
    narration: textSchema,
    focus: z.array(idSchema).default([]),
    travel: z.object({ edgeId: idSchema, reverse: z.boolean().default(false), payload: z.string().max(MAX_LABEL).optional() }).optional(),
    highlight: z.array(idSchema).default([]),
    annotate: z.array(z.object({ nodeId: idSchema, text: textSchema })).default([]),
    payload: payloadSchema.optional(),
    expand: idSchema.optional(),
    substeps: z.array(stepSchema).default([]),
  }),
);

const riskSchema = z.object({
  id: idSchema,
  category: z.enum(RISK_CATEGORIES),
  severity: z.enum(SEVERITIES),
  title: labelSchema,
  explanation: textSchema,
  nodeIds: z.array(idSchema).min(1),
  mitigation: textSchema.optional(),
});

export const sceneSchema = z.object({
  id: idSchema,
  title: labelSchema,
  summary: textSchema.optional(),
  language: z.string().regex(LANGUAGE_TAG, 'must be a BCP-47 language tag like "es" or "pt-BR"'),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
  edges: z.array(edgeSchema).default([]),
  groups: z.array(groupSchema).default([]),
  steps: z.array(stepSchema).max(MAX_STEPS).default([]),
  risks: z.array(riskSchema).default([]),
});

export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = z.input<typeof sceneSchema>;
export type SceneNode = Scene['nodes'][number];
export type SceneEdge = Scene['edges'][number];
export type SceneGroup = Scene['groups'][number];
export type SceneRisk = Scene['risks'][number];
export type ScaleRow = z.infer<typeof scaleRowSchema>;
