import { defineScene } from './define';

export const speakerReconcileAlgorithm = defineScene({
  id: 'speaker-reconcile-algorithm',
  title: 'Reconciliation algorithm (inside the sync worker)',
  kind: 'algorithm',
  nodes: [
    { id: 'fetch', type: 'function', label: 'fetchAllPages()' },
    { id: 'remote', type: 'data', label: 'remote: Map<externalId, speaker>' },
    { id: 'local', type: 'data', label: 'local: Map<externalId, mapping>' },
    { id: 'diff', type: 'function', label: 'diff(remote, local)' },
    { id: 'upserts', type: 'data', label: 'toUpsert[]' },
    { id: 'deletes', type: 'data', label: 'toDelete[]', meta: { risk: 'hot', notes: 'Deletes trust a possibly incomplete remote list' } },
    { id: 'apply', type: 'function', label: 'applyInTransaction()' },
  ],
  edges: [
    { id: 'f-r', from: 'fetch', to: 'remote', kind: 'write' },
    { id: 'r-d', from: 'remote', to: 'diff', kind: 'read' },
    { id: 'l-d', from: 'local', to: 'diff', kind: 'read' },
    { id: 'd-u', from: 'diff', to: 'upserts', kind: 'write' },
    { id: 'd-x', from: 'diff', to: 'deletes', kind: 'write' },
    { id: 'u-a', from: 'upserts', to: 'apply', kind: 'read' },
    { id: 'x-a', from: 'deletes', to: 'apply', kind: 'read' },
  ],
  steps: [
    { narration: 'Loop: fetch page after page until "next" is empty, filling a map keyed by external id.', focus: ['fetch', 'remote'], travel: { edgeId: 'f-r', payload: 'page' }, payload: { format: 'json', before: '{}', after: '{\n  "cv-17": "Ada Lovelace",\n  "cv-18": "Alan Turing"\n}' } },
    { narration: 'Load existing mappings for this event into a second map.', focus: ['local'], payload: { format: 'json', after: '{\n  "cv-17": "speaker 901",\n  "cv-99": "speaker 950"\n}' } },
    { narration: 'Diff both maps in O(n): keys only in remote → upsert; keys only in local → delete.', focus: ['diff'], highlight: ['remote', 'local'], travel: { edgeId: 'r-d' } },
    { narration: 'cv-17 exists in both → update. cv-18 is new → insert.', focus: ['upserts'], travel: { edgeId: 'd-u', payload: '2 rows' }, payload: { format: 'json', after: '[\n  { "externalId": "cv-17", "op": "update" },\n  { "externalId": "cv-18", "op": "insert" }\n]' } },
    { narration: 'cv-99 is missing remotely → delete. If Cvent returned a partial list, this deletes real speakers.', focus: ['deletes'], travel: { edgeId: 'd-x', payload: '1 row' }, annotate: [{ nodeId: 'deletes', text: 'Risk: eventual consistency' }] },
    { narration: 'Everything is applied in one transaction so a failure leaves no half-synced state.', focus: ['apply'], highlight: ['upserts', 'deletes'], travel: { edgeId: 'u-a' } },
  ],
});
