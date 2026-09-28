import { describe, expect, it } from 'vitest';
import { simulateLoad, validateScene, type Scene } from '../src/index';

const scene = (): Scene => {
  const result = validateScene({
    id: 'load',
    title: 'Load',
    kind: 'load',
    nodes: [
      { id: 'client', type: 'client', label: 'Client' },
      { id: 'api', type: 'service', label: 'API' },
      { id: 'queue', type: 'queue', label: 'Jobs' },
      { id: 'worker', type: 'service', label: 'Worker' },
      { id: 'db', type: 'db', label: 'Postgres' },
    ],
    edges: [
      { id: 'c-a', from: 'client', to: 'api', kind: 'sync' },
      { id: 'a-q', from: 'api', to: 'queue', kind: 'async' },
      { id: 'q-w', from: 'queue', to: 'worker', kind: 'async' },
      { id: 'a-d', from: 'api', to: 'db', kind: 'read' },
    ],
    load: {
      rps: 40,
      nodes: {
        api: { capacity: 100, latencyMs: 20 },
        queue: { capacity: 30, latencyMs: 5 },
        worker: { capacity: 50, latencyMs: 100 },
        db: { capacity: 200, latencyMs: 5 },
      },
      queues: { queue: { consumers: 2, maxDepth: 1000 } },
    },
  });
  if (!result.ok) throw new Error(result.errors.join('\n'));
  return result.scene;
};

describe('simulateLoad', () => {
  it('computes M/M/1-style latency below capacity', () => {
    const r = simulateLoad(scene(), 40);
    expect(r.nodes.api!.utilization).toBeCloseTo(0.4);
    expect(r.nodes.api!.latencyMs).toBeCloseTo(33.333, 2);
    expect(r.nodes.api!.queueDepth).toBeCloseTo(0.2667, 3);
    expect(r.nodes.queue!.capacityRps).toBe(60);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(15, 5);
    expect(r.nodes.worker!.latencyMs).toBeCloseTo(500, 5);
    expect(r.nodes.worker!.hot).toBe(true);
    expect(r.nodes.db!.arrivalRps).toBe(40);
    expect(r.bottlenecks).toEqual([]);
    expect(r.endToEndLatencyMs).toBeCloseTo(548.333, 2);
  });

  it('saturates nodes, throttles downstream and ranks bottlenecks', () => {
    const r = simulateLoad(scene(), 80, 10);
    expect(r.nodes.queue!.saturated).toBe(true);
    expect(r.nodes.queue!.throughputRps).toBe(60);
    expect(r.nodes.queue!.queueDepth).toBe(200);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(3338.333, 2);
    expect(r.nodes.worker!.arrivalRps).toBe(60);
    expect(r.nodes.worker!.queueDepth).toBe(100);
    expect(r.nodes.worker!.latencyMs).toBeCloseTo(2100, 5);
    expect(r.bottlenecks).toEqual(['queue', 'worker']);
  });

  it('caps queue depth at maxDepth', () => {
    const r = simulateLoad(scene(), 200, 100);
    expect(r.nodes.api!.queueDepth).toBe(10_000);
    expect(r.nodes.queue!.queueDepth).toBe(1000);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(16_671.667, 2);
  });

  it('returns finite values at rps 0', () => {
    const r = simulateLoad(scene(), 0);
    expect(r.nodes.api!.latencyMs).toBe(20);
    expect(r.nodes.api!.utilization).toBe(0);
    Object.values(r.nodes).forEach((n) => {
      expect(Number.isFinite(n.latencyMs)).toBe(true);
      expect(Number.isFinite(n.queueDepth)).toBe(true);
    });
    expect(Number.isFinite(r.endToEndLatencyMs)).toBe(true);
  });

  it('sums fan-in arrivals', () => {
    const s = scene();
    s.nodes.push({ id: 'cron', type: 'client', label: 'Cron', meta: {} });
    s.edges.push({ id: 'cr-a', from: 'cron', to: 'api', kind: 'sync' });
    expect(simulateLoad(s, 10).nodes.api!.arrivalRps).toBe(20);
  });

  it('ignores back edges deterministically', () => {
    const s = scene();
    s.edges.push({ id: 'w-a', from: 'worker', to: 'api', kind: 'calls' });
    const r = simulateLoad(s, 40);
    expect(r.ignoredEdges).toEqual(['w-a']);
    expect(r.nodes.api!.arrivalRps).toBe(40);
  });

  it('rejects invalid rps', () => {
    expect(() => simulateLoad(scene(), -1)).toThrow(RangeError);
    expect(() => simulateLoad(scene(), Number.NaN)).toThrow(RangeError);
  });
});
