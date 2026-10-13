import { EventEmitter } from 'node:events';
import { mkdir } from 'node:fs/promises';
import { createFakeQuery } from './agent/fakeQuery';
import { createSdkQuery } from './agent/sdkRunner';
import { buildApp } from './app';
import { loadConfig } from './config';
import { createRunRegistry } from './runs/registry';

const config = loadConfig();
await mkdir(config.home, { recursive: true });
const queryFn = config.agent.fake ? createFakeQuery() : createSdkQuery();
const app = buildApp({ config, queryFn, events: new EventEmitter(), runs: createRunRegistry() });

const address = await app.listen({ port: config.port, host: config.host });
const port = Number(new URL(address).port);
console.log(`rdi core listening on http://${config.host}:${port} (home ${config.home})`);
console.log(`agent: ${config.agent.fake ? 'fake-scripted' : `claude agent sdk${config.agent.model ? ` (${config.agent.model})` : ''}`}`);
if (process.send) process.send({ type: 'listening', port });

const shutdown = () => {
  void app.close().then(() => process.exit(0));
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
