import { homedir } from 'node:os';
import { join } from 'node:path';

export type Config = {
  port: number;
  host: string;
  home: string;
  nodeEnv: string;
  webDist: string | null;
  agent: { fake: boolean; model: string | null; maxTurns: number; maxBudgetUsd: number | null; heartbeatMs: number; claudeExecutable: string | null };
};

const DEFAULTS = {
  RDI_PORT: '4040',
  RDI_HOST: '127.0.0.1',
  RDI_HOME: '',
  NODE_ENV: 'development',
  RDI_WEB_DIST: '',
  RDI_FAKE_AGENT: 'false',
  AGENT_MODEL: '',
  AGENT_MAX_TURNS: '16',
  AGENT_MAX_BUDGET_USD: '',
  CLAUDE_EXECUTABLE: '',
};

const PRODUCTION = 'production';
const SSE_HEARTBEAT_MS = 15_000;
const RDI_DIR = '.rdi';

const orNull = (value: string) => (value === '' ? null : value);

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const read = (key: keyof typeof DEFAULTS) => env[key] ?? DEFAULTS[key];
  const nodeEnv = read('NODE_ENV');
  const production = nodeEnv === PRODUCTION;
  const budget = read('AGENT_MAX_BUDGET_USD');
  return {
    port: Number(read('RDI_PORT')),
    host: read('RDI_HOST'),
    home: read('RDI_HOME') || join(homedir(), RDI_DIR),
    nodeEnv,
    webDist: orNull(read('RDI_WEB_DIST')),
    agent: {
      fake: !production && read('RDI_FAKE_AGENT') === 'true',
      model: orNull(read('AGENT_MODEL')),
      maxTurns: Number(read('AGENT_MAX_TURNS')),
      maxBudgetUsd: budget === '' ? null : Number(budget),
      heartbeatMs: SSE_HEARTBEAT_MS,
      claudeExecutable: orNull(read('CLAUDE_EXECUTABLE')),
    },
  };
};
