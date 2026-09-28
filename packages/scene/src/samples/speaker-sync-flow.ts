import { defineScene } from './define';

export const speakerSyncFlow = defineScene({
  id: 'speaker-sync-flow',
  title: 'Speaker sync from Cvent',
  kind: 'flow',
  nodes: [
    { id: 'organizer', type: 'client', label: 'Organizer (browser)' },
    { id: 'web', type: 'service', label: 'Web app', repo: 'web-ui', meta: { tech: 'React' } },
    { id: 'sync-endpoint', type: 'endpoint', label: 'POST /integrations/:id/sync', repo: 'web-api', meta: { tech: 'Express' } },
    { id: 'jobs-queue', type: 'queue', label: 'jobs queue', repo: 'web-api', meta: { tech: 'SQS' } },
    { id: 'worker', type: 'service', label: 'Sync worker', repo: 'web-api', meta: { tech: 'Node worker', notes: 'Double-click to see the reconciliation algorithm' } },
    { id: 'lock', type: 'cache', label: 'Redis lock', meta: { tech: 'Redlock', risk: 'spof' } },
    { id: 'cvent', type: 'external', label: 'Cvent REST API', meta: { risk: 'bottleneck', notes: 'Rate limited, paginated, eventually consistent' } },
    { id: 'speakers', type: 'table', label: 'speakers', meta: { tech: 'Postgres' } },
  ],
  edges: [
    { id: 'o-w', from: 'organizer', to: 'web', kind: 'sync', label: 'click "Sync now"' },
    { id: 'w-e', from: 'web', to: 'sync-endpoint', kind: 'sync', label: 'HTTP' },
    { id: 'e-q', from: 'sync-endpoint', to: 'jobs-queue', kind: 'async', label: 'enqueue' },
    { id: 'q-k', from: 'jobs-queue', to: 'worker', kind: 'async', label: 'consume' },
    { id: 'k-l', from: 'worker', to: 'lock', kind: 'write', label: 'acquire' },
    { id: 'k-c', from: 'worker', to: 'cvent', kind: 'calls', label: 'GET /speakers?page=n' },
    { id: 'k-s', from: 'worker', to: 'speakers', kind: 'write', label: 'upsert / delete' },
  ],
  groups: [
    { id: 'g-web', label: 'web-ui', nodeIds: ['web'] },
    { id: 'g-api', label: 'web-api', nodeIds: ['sync-endpoint', 'jobs-queue', 'worker'] },
  ],
  steps: [
    { narration: 'The organizer clicks "Sync now" in the web app.', focus: ['organizer', 'web'], travel: { edgeId: 'o-w', payload: 'click' } },
    {
      narration: 'The web app calls the sync endpoint for integration 42.',
      focus: ['sync-endpoint'],
      travel: { edgeId: 'w-e', payload: 'POST' },
      payload: { format: 'json', after: '{\n  "integrationId": 42,\n  "eventId": 5954\n}' },
    },
    {
      narration: 'The endpoint does not sync inline: it enqueues a job and answers 202 immediately.',
      focus: ['jobs-queue'],
      travel: { edgeId: 'e-q', payload: 'job' },
      payload: { format: 'json', before: '{\n  "integrationId": 42,\n  "eventId": 5954\n}', after: '{\n  "type": "cvent.speakers.sync",\n  "integrationId": 42,\n  "eventId": 5954,\n  "attempt": 1\n}' },
    },
    { narration: 'A worker picks the job and takes a Redis lock so two syncs never run for the same event.', focus: ['worker', 'lock'], travel: { edgeId: 'k-l', payload: 'lock' }, annotate: [{ nodeId: 'lock', text: 'Lock held ~2-4s' }] },
    {
      narration: 'The worker pages through Cvent speakers. This is the slowest hop: rate limits and pagination.',
      focus: ['cvent'],
      highlight: ['worker'],
      travel: { edgeId: 'k-c', payload: 'page 1..n' },
      payload: { format: 'json', after: '{\n  "data": [\n    { "id": "cv-17", "firstName": "Ada", "lastName": "Lovelace" }\n  ],\n  "paging": { "next": "page=2" }\n}' },
    },
    {
      narration: 'Each Cvent speaker is mapped and upserted; mappings missing from Cvent are deleted.',
      focus: ['speakers'],
      travel: { edgeId: 'k-s', payload: 'rows' },
      payload: { format: 'sql', before: '-- Cvent speaker cv-17', after: "INSERT INTO speakers (external_id, first_name, last_name)\nVALUES ('cv-17', 'Ada', 'Lovelace')\nON CONFLICT (external_id) DO UPDATE SET first_name = EXCLUDED.first_name;" },
    },
  ],
  zoom: { worker: 'speaker-reconcile-algorithm' },
});
