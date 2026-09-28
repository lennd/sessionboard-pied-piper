import { defineScene } from './define';

export const iotTelemetry = defineScene({
  id: 'iot-telemetry',
  title: 'IoT telemetry ingestion',
  summary: 'How sensor readings travel from devices to dashboards and on-call alerts.',
  language: 'en',
  nodes: [
    { id: 'devices', label: 'Sensor fleet', role: 'actor', kind: 'ESP32 firmware', repo: 'firmware', summary: 'Thousands of devices publishing a reading every 5 seconds.' },
    {
      id: 'broker', label: 'MQTT broker', role: 'channel', kind: 'EMQX cluster', repo: 'ingest', summary: 'Receives device messages and fans them out to subscribers.',
      scale: {
        low: { status: 'ok', note: 'Idle most of the time.' },
        medium: { status: 'ok', note: 'Comfortable with a few thousand devices.' },
        high: { status: 'strained', note: 'Connection count per node becomes the limit.' },
        strategy: 'horizontal', advice: 'Add broker nodes; shard devices by id.',
      },
    },
    {
      id: 'processor', label: 'Stream processor', role: 'compute', kind: 'Flink job', repo: 'ingest', summary: 'Deduplicates readings and aggregates them per device every minute.',
      scale: {
        low: { status: 'ok', note: 'Tiny windows.' },
        medium: { status: 'strained', note: 'Window state grows with active devices.' },
        high: { status: 'limit', note: 'Memory pressure from per-device state.' },
        strategy: 'horizontal', advice: 'Increase parallelism keyed by device id; spill state to RocksDB.',
      },
    },
    { id: 'dedupe', label: 'dedupe', role: 'logic', kind: 'hash set per window', parent: 'processor', summary: 'Drops readings already seen in the current window.', complexity: { time: 'O(1) avg', space: 'O(n)', note: 'n = readings in the window.' } },
    { id: 'window', label: '60s window', role: 'logic', kind: 'tumbling window', parent: 'processor', summary: 'Buckets readings into one-minute windows per device.', complexity: { time: 'O(n)' } },
    { id: 'aggregate', label: 'aggregates', role: 'data', kind: 'min / max / avg', parent: 'processor', summary: 'Per-device statistics for the closed window.' },
    {
      id: 'tsdb', label: 'Time-series DB', role: 'storage', kind: 'TimescaleDB', repo: 'ingest', summary: 'Stores one aggregate row per device per minute.',
      scale: {
        low: { status: 'ok', note: 'Trivial write rate.' },
        medium: { status: 'ok', note: 'Batched inserts keep up.' },
        high: { status: 'strained', note: 'Chunk size and indexes need tuning.' },
        strategy: 'vertical', advice: 'Tune chunk intervals and add compression; scale the primary.',
      },
    },
    {
      id: 'alerts', label: 'Alerting service', role: 'compute', kind: 'rules engine', repo: 'alerts', summary: 'Evaluates thresholds on aggregates.',
      scale: {
        low: { status: 'ok', note: 'Few rules, few events.' },
        medium: { status: 'ok', note: 'Fine.' },
        high: { status: 'strained', note: 'Alert storms when many devices breach at once.' },
        strategy: 'horizontal', advice: 'Group alerts per site before paging.',
      },
    },
    { id: 'pager', label: 'On-call pager', role: 'external', kind: 'PagerDuty', summary: 'Pages the engineer on call.' },
  ],
  edges: [
    { id: 'e-pub', from: 'devices', to: 'broker', kind: 'async', label: 'publish telemetry/{id}' },
    { id: 'e-sub', from: 'broker', to: 'dedupe', kind: 'async', label: 'subscribe' },
    { id: 'e-dedupe-window', from: 'dedupe', to: 'window', kind: 'calls' },
    { id: 'e-window-agg', from: 'window', to: 'aggregate', kind: 'write' },
    { id: 'e-flush', from: 'aggregate', to: 'tsdb', kind: 'write', label: 'flush every 60s' },
    { id: 'e-breach', from: 'aggregate', to: 'alerts', kind: 'async', label: 'threshold breach' },
    { id: 'e-page', from: 'alerts', to: 'pager', kind: 'calls', label: 'page' },
  ],
  steps: [
    { id: 's1', narration: 'A device publishes a temperature reading to the broker.', focus: ['broker'], travel: { edgeId: 'e-pub', payload: '21.7°C' }, payload: { format: 'json', after: '{ "device": "d-4411", "temp": 21.7, "ts": 1790614500 }' } },
    {
      id: 's2', narration: 'The stream processor receives the reading.', focus: ['processor'], travel: { edgeId: 'e-sub', payload: 'reading' }, expand: 'processor',
      substeps: [
        { id: 's2-1', narration: 'Duplicates from device retries are dropped.', focus: ['dedupe'], annotate: [{ nodeId: 'dedupe', text: 'QoS 1 can resend' }] },
        { id: 's2-2', narration: 'The reading lands in the device’s current one-minute window.', focus: ['window'], travel: { edgeId: 'e-dedupe-window' } },
        { id: 's2-3', narration: 'When the window closes, min/max/avg are computed.', focus: ['aggregate'], travel: { edgeId: 'e-window-agg', payload: 'avg 21.9' } },
      ],
    },
    { id: 's3', narration: 'Aggregates are flushed to the time-series database.', focus: ['tsdb'], travel: { edgeId: 'e-flush', payload: 'batch' } },
    { id: 's4', narration: 'A threshold breach is sent to the alerting service.', focus: ['alerts'], travel: { edgeId: 'e-breach', payload: 'temp > 40' } },
    { id: 's5', narration: 'The on-call engineer is paged.', focus: ['pager'], travel: { edgeId: 'e-page', payload: 'P2' } },
  ],
  risks: [
    { id: 'r-state', category: 'performance', severity: 'high', title: 'Window state grows with device count', explanation: 'Per-device state lives in memory for the whole window.', nodeIds: ['window', 'processor'], mitigation: 'Key by device, raise parallelism, use RocksDB state backend.' },
    { id: 'r-qos', category: 'reliability', severity: 'medium', title: 'Readings lost with QoS 0', explanation: 'Devices on QoS 0 drop readings during broker failovers.', nodeIds: ['devices', 'broker'], mitigation: 'Use QoS 1 plus dedupe (already in place).' },
    { id: 'r-creds', category: 'security', severity: 'critical', title: 'Shared device credential', explanation: 'All devices authenticate with the same username/password.', nodeIds: ['devices', 'broker'], mitigation: 'Per-device X.509 certificates.' },
    { id: 'r-dedupe', category: 'complexity', severity: 'low', title: 'Dedupe set is O(n) per window', explanation: 'The hash set keeps every reading id seen in the window.', nodeIds: ['dedupe'], mitigation: 'Bloom filter per device window.' },
  ],
});
