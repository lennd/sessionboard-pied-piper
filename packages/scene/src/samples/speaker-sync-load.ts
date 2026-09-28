import { defineScene } from './define';

export const speakerSyncLoad = defineScene({
  id: 'speaker-sync-load',
  title: 'Speaker sync under load',
  kind: 'load',
  nodes: [
    { id: 'organizers', type: 'client', label: 'Organizers' },
    { id: 'sync-endpoint', type: 'endpoint', label: 'POST /integrations/:id/sync' },
    { id: 'queue', type: 'queue', label: 'jobs queue', meta: { tech: 'SQS' } },
    { id: 'worker', type: 'service', label: 'Sync worker' },
    { id: 'cvent', type: 'external', label: 'Cvent REST API', meta: { risk: 'bottleneck' } },
    { id: 'speakers', type: 'table', label: 'speakers' },
  ],
  edges: [
    { id: 'o-e', from: 'organizers', to: 'sync-endpoint', kind: 'sync' },
    { id: 'e-q', from: 'sync-endpoint', to: 'queue', kind: 'async' },
    { id: 'q-w', from: 'queue', to: 'worker', kind: 'async' },
    { id: 'w-c', from: 'worker', to: 'cvent', kind: 'calls' },
    { id: 'w-s', from: 'worker', to: 'speakers', kind: 'write' },
  ],
  load: {
    rps: 5,
    nodes: {
      'sync-endpoint': { capacity: 200, latencyMs: 15 },
      queue: { capacity: 4, latencyMs: 20 },
      worker: { capacity: 40, latencyMs: 250 },
      cvent: { capacity: 25, latencyMs: 400 },
      speakers: { capacity: 300, latencyMs: 8 },
    },
    queues: { queue: { consumers: 3, maxDepth: 5000 } },
  },
});
