import type { Scene } from './schema';

export type NodeLoad = {
  arrivalRps: number;
  throughputRps: number;
  capacityRps: number;
  utilization: number;
  queueDepth: number;
  latencyMs: number;
  saturated: boolean;
  hot: boolean;
};

export type LoadResult = {
  nodes: Record<string, NodeLoad>;
  endToEndLatencyMs: number;
  bottlenecks: string[];
  ignoredEdges: string[];
};

const HOT_THRESHOLD = 0.8;
const MAX_STEADY_UTILIZATION = 0.95;
const MS_PER_SECOND = 1000;
const DEFAULT_ELAPSED_SECONDS = 10;

const findBackEdges = (scene: Scene): Set<string> => {
  const outgoing = new Map<string, Scene['edges']>();
  scene.edges.forEach((e) => outgoing.set(e.from, [...(outgoing.get(e.from) ?? []), e]));
  const state = new Map<string, 'visiting' | 'done'>();
  const back = new Set<string>();
  const visit = (id: string) => {
    state.set(id, 'visiting');
    (outgoing.get(id) ?? []).forEach((edge) => {
      const next = state.get(edge.to);
      if (next === 'visiting') back.add(edge.id);
      else if (next === undefined) visit(edge.to);
    });
    state.set(id, 'done');
  };
  scene.nodes.forEach((n) => {
    if (!state.has(n.id)) visit(n.id);
  });
  return back;
};

const topologicalOrder = (scene: Scene, edges: Scene['edges']): string[] => {
  const indegree = new Map(scene.nodes.map((n) => [n.id, 0]));
  edges.forEach((e) => indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1));
  const ready = scene.nodes.filter((n) => indegree.get(n.id) === 0).map((n) => n.id);
  const order: string[] = [];
  while (ready.length > 0) {
    const id = ready.shift() as string;
    order.push(id);
    edges
      .filter((e) => e.from === id)
      .forEach((e) => {
        const remaining = (indegree.get(e.to) ?? 0) - 1;
        indegree.set(e.to, remaining);
        if (remaining === 0) ready.push(e.to);
      });
  }
  return order;
};

/**
 * Deterministic steady-state estimate of how `rps` flows through a scene.
 * Back edges (cycles) are ignored; entry nodes receive `rps`; fan-out duplicates and fan-in sums
 * throughput. Below capacity uses M/M/1 approximations with utilization capped at 0.95; at or above
 * capacity a backlog grows for `elapsedSeconds` on top of that capped baseline (total depth capped by
 * the queue's `maxDepth`), so latency and depth never drop as traffic rises. Results are estimates.
 */
export const simulateLoad = (scene: Scene, rps: number, elapsedSeconds = DEFAULT_ELAPSED_SECONDS): LoadResult => {
  if (!Number.isFinite(rps) || rps < 0) throw new RangeError(`rps must be a finite number >= 0, got ${rps}`);

  const backEdges = findBackEdges(scene);
  const edges = scene.edges.filter((e) => !backEdges.has(e.id));
  const order = topologicalOrder(scene, edges);
  const incoming = (id: string) => edges.filter((e) => e.to === id);
  const nodes: Record<string, NodeLoad> = {};
  const pathLatency = new Map<string, number>();

  order.forEach((id) => {
    const parents = incoming(id);
    const arrival = parents.length === 0 ? rps : parents.reduce((sum, e) => sum + (nodes[e.from]?.throughputRps ?? 0), 0);
    const config = scene.load?.nodes[id];
    const queue = scene.load?.queues?.[id];
    const capacity = config ? config.capacity * (queue?.consumers ?? 1) : Number.POSITIVE_INFINITY;
    const baseLatency = config?.latencyMs ?? 0;
    const utilization = Number.isFinite(capacity) ? arrival / capacity : 0;
    const saturated = arrival >= capacity;
    const steadyUtilization = Math.min(utilization, MAX_STEADY_UTILIZATION);
    const steadyDepth = (steadyUtilization * steadyUtilization) / (1 - steadyUtilization);
    const steadyLatency = baseLatency / (1 - steadyUtilization);
    const backlog = saturated ? (arrival - capacity) * elapsedSeconds : 0;
    const queueDepth = Math.min(steadyDepth + backlog, queue?.maxDepth ?? Number.POSITIVE_INFINITY);
    const latencyMs = saturated
      ? steadyLatency + (Math.max(0, queueDepth - steadyDepth) / capacity) * MS_PER_SECOND
      : steadyLatency;

    nodes[id] = {
      arrivalRps: arrival,
      throughputRps: saturated ? capacity : arrival,
      capacityRps: capacity,
      utilization,
      queueDepth,
      latencyMs,
      saturated,
      hot: !saturated && utilization >= HOT_THRESHOLD,
    };
    const upstream = Math.max(0, ...parents.map((e) => pathLatency.get(e.from) ?? 0));
    pathLatency.set(id, upstream + latencyMs);
  });

  const bottlenecks = order
    .filter((id) => nodes[id]?.saturated)
    .sort((a, b) => (nodes[b]?.utilization ?? 0) - (nodes[a]?.utilization ?? 0));

  return {
    nodes,
    endToEndLatencyMs: Math.max(0, ...pathLatency.values()),
    bottlenecks,
    ignoredEdges: scene.edges.filter((e) => backEdges.has(e.id)).map((e) => e.id),
  };
};
