import { describe, expect, it } from 'vitest';
import { simulateLoad, type LoadConfig, type SimGraph } from '../src/index';

type Fixture = SimGraph & { load: LoadConfig };

const scene = (): Fixture => ({
  nodes: [{ id: 'client' }, { id: 'api' }, { id: 'queue' }, { id: 'worker' }, { id: 'db' }],
  edges: [
    { id: 'c-a', from: 'client', to: 'api' },
    { id: 'a-q', from: 'api', to: 'queue' },
    { id: 'q-w', from: 'queue', to: 'worker' },
    { id: 'a-d', from: 'api', to: 'db' },
  ],
  load: {
    rps: 40,
    nodes: { api: { capacity: 100, latencyMs: 20 }, queue: { capacity: 30, latencyMs: 5 }, worker: { capacity: 50, latencyMs: 100 }, db: { capacity: 200, latencyMs: 5 } },
    queues: { queue: { consumers: 2, maxDepth: 1000 } },
  },
});

describe('simulateLoad', () => {
  it('computes M/M/1-style latency below capacity', () => {
    const r = simulateLoad(scene(), scene().load, 40);
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
    const r = simulateLoad(scene(), scene().load, 80, 10);
    expect(r.nodes.queue!.saturated).toBe(true);
    expect(r.nodes.queue!.throughputRps).toBe(60);
    expect(r.nodes.queue!.queueDepth).toBeCloseTo(218.05, 5);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(3433.333, 2);
    expect(r.nodes.worker!.arrivalRps).toBe(60);
    expect(r.nodes.worker!.queueDepth).toBeCloseTo(118.05, 5);
    expect(r.nodes.worker!.latencyMs).toBeCloseTo(4000, 5);
    expect(r.bottlenecks).toEqual(['queue', 'worker']);
  });

  it('caps queue depth at maxDepth', () => {
    const r = simulateLoad(scene(), scene().load, 200, 100);
    expect(r.nodes.api!.queueDepth).toBeCloseTo(10_018.05, 5);
    expect(r.nodes.queue!.queueDepth).toBe(1000);
    expect(r.nodes.queue!.latencyMs).toBeCloseTo(100 + ((1000 - 18.05) / 60) * 1000, 2);
  });

  it('returns finite values at rps 0', () => {
    const r = simulateLoad(scene(), scene().load, 0);
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
    s.nodes.push({ id: 'cron' });
    s.edges.push({ id: 'cr-a', from: 'cron', to: 'api' });
    expect(simulateLoad(s, s.load, 10).nodes.api!.arrivalRps).toBe(20);
  });

  it('ignores back edges deterministically', () => {
    const s = scene();
    s.edges.push({ id: 'w-a', from: 'worker', to: 'api' });
    const r = simulateLoad(s, s.load, 40);
    expect(r.ignoredEdges).toEqual(['w-a']);
    expect(r.nodes.api!.arrivalRps).toBe(40);
  });

  it('never lowers latency or queue depth as traffic rises across capacity', () => {
    const s = scene();
    const series = Array.from({ length: 121 }, (_, i) => simulateLoad(s, s.load, i));
    ['api', 'queue', 'worker', 'db'].forEach((id) =>
      series.slice(1).forEach((r, i) => {
        const prev = series[i]!.nodes[id]!;
        expect(r.nodes[id]!.latencyMs).toBeGreaterThanOrEqual(prev.latencyMs);
        expect(r.nodes[id]!.queueDepth).toBeGreaterThanOrEqual(prev.queueDepth);
      }),
    );
  });

  it('rejects invalid rps', () => {
    expect(() => simulateLoad(scene(), scene().load, -1)).toThrow(RangeError);
    expect(() => simulateLoad(scene(), scene().load, Number.NaN)).toThrow(RangeError);
  });
});
