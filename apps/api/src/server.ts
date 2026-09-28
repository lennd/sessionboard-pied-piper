import { buildApp } from './app';
import { createInfraChecks } from './checks';
import { loadConfig } from './config';

const config = loadConfig();
const infra = createInfraChecks(config);
const app = buildApp({ checks: infra.checks, onClose: infra.close });

await app.listen({ port: config.port, host: '0.0.0.0' });
console.log(`api listening on http://localhost:${config.port}`);
