import { defineScene } from './define';

export const prImpact = defineScene({
  id: 'pr-impact',
  title: 'PR #1234 — map Cvent speaker photos',
  kind: 'diff-impact',
  nodes: [
    { id: 'web', type: 'service', label: 'Web app', repo: 'web-ui' },
    { id: 'worker', type: 'service', label: 'Sync worker', repo: 'web-api', meta: { change: 'modified' } },
    { id: 'speaker-mapper', type: 'function', label: 'mapCventSpeaker()', repo: 'web-api', meta: { change: 'added' } },
    { id: 's3', type: 'external', label: 'S3 content bucket', meta: { change: 'added', risk: 'hot', notes: 'New write path per speaker' } },
    { id: 'speakers', type: 'table', label: 'speakers', meta: { change: 'modified', notes: 'New column photo_url' } },
    { id: 'legacy-photo', type: 'function', label: 'copyPhotoLegacy()', repo: 'web-api', meta: { change: 'removed' } },
  ],
  edges: [
    { id: 'w-sp', from: 'web', to: 'speakers', kind: 'read' },
    { id: 'k-m', from: 'worker', to: 'speaker-mapper', kind: 'calls' },
    { id: 'm-s3', from: 'speaker-mapper', to: 's3', kind: 'write' },
    { id: 'm-sp', from: 'speaker-mapper', to: 'speakers', kind: 'write' },
    { id: 'k-l', from: 'worker', to: 'legacy-photo', kind: 'calls' },
  ],
});
