import { z } from 'zod';

export const NODE_TYPES = ['client', 'service', 'endpoint', 'queue', 'db', 'table', 'cache', 'external', 'function', 'data'] as const;
export const EDGE_KINDS = ['sync', 'async', 'read', 'write', 'calls'] as const;
export const SCENE_KINDS = ['flow', 'algorithm', 'load', 'diff-impact'] as const;
export const RISKS = ['bottleneck', 'spof', 'hot'] as const;
export const CHANGES = ['added', 'modified', 'removed'] as const;
export const PAYLOAD_FORMATS = ['json', 'sql', 'text'] as const;

const MAX_LABEL = 120;
const MAX_TEXT = 2000;
const MAX_PAYLOAD = 20_000;
const MAX_NODES = 80;
const MAX_STEPS = 60;

const idSchema = z.string().min(1).max(MAX_LABEL);

const nodeSchema = z.object({
  id: idSchema,
  type: z.enum(NODE_TYPES),
  label: z.string().min(1).max(MAX_LABEL),
  repo: z.string().max(MAX_LABEL).optional(),
  graphRef: z.string().max(MAX_TEXT).optional(),
  meta: z
    .object({
      tech: z.string().max(MAX_LABEL).optional(),
      notes: z.string().max(MAX_TEXT).optional(),
      risk: z.enum(RISKS).optional(),
      change: z.enum(CHANGES).optional(),
    })
    .default({}),
});

const edgeSchema = z.object({
  id: idSchema,
  from: idSchema,
  to: idSchema,
  kind: z.enum(EDGE_KINDS),
  label: z.string().max(MAX_LABEL).optional(),
});

const groupSchema = z.object({
  id: idSchema,
  label: z.string().min(1).max(MAX_LABEL),
  nodeIds: z.array(idSchema).min(1),
});

const payloadSchema = z
  .object({
    format: z.enum(PAYLOAD_FORMATS),
    before: z.string().max(MAX_PAYLOAD).optional(),
    after: z.string().max(MAX_PAYLOAD).optional(),
  })
  .refine((p) => p.before !== undefined || p.after !== undefined, { message: 'payload needs before or after' });

const stepSchema = z.object({
  narration: z.string().min(1).max(MAX_TEXT),
  focus: z.array(idSchema).default([]),
  travel: z.object({ edgeId: idSchema, payload: z.string().max(MAX_LABEL).optional() }).optional(),
  payload: payloadSchema.optional(),
  highlight: z.array(idSchema).default([]),
  annotate: z.array(z.object({ nodeId: idSchema, text: z.string().min(1).max(MAX_TEXT) })).default([]),
});

const loadSchema = z.object({
  rps: z.number().positive(),
  nodes: z.record(z.string(), z.object({ capacity: z.number().positive(), latencyMs: z.number().nonnegative() })),
  queues: z
    .record(z.string(), z.object({ consumers: z.number().int().positive(), maxDepth: z.number().int().positive().optional() }))
    .optional(),
});

export const sceneSchema = z.object({
  id: idSchema,
  title: z.string().min(1).max(MAX_LABEL),
  kind: z.enum(SCENE_KINDS),
  nodes: z.array(nodeSchema).min(1).max(MAX_NODES),
  edges: z.array(edgeSchema).default([]),
  groups: z.array(groupSchema).default([]),
  steps: z.array(stepSchema).max(MAX_STEPS).default([]),
  zoom: z.record(z.string(), idSchema).optional(),
  load: loadSchema.optional(),
});

export type Scene = z.infer<typeof sceneSchema>;
export type SceneInput = z.input<typeof sceneSchema>;
export type SceneNode = Scene['nodes'][number];
export type SceneEdge = Scene['edges'][number];
export type SceneStep = Scene['steps'][number];
export type SceneLoad = NonNullable<Scene['load']>;
