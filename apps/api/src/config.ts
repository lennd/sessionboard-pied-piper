export type Config = {
  port: number;
  databaseUrl: string;
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  redisUrl: string;
  nodeEnv: string;
  appUrl: string;
  devRoutes: boolean;
  cookieSecure: boolean;
  rateLimitPrefix: string;
  rateLimitsEnabled: boolean;
  dbEnsure: boolean;
  trustProxy: boolean | number | string;
  demoRepos: boolean;
  github: { appId: string; privateKey: string; slug: string; webhookSecret: string; stateSecret: string } | null;
};

const DEFAULTS = {
  API_PORT: '4040',
  DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi',
  NEO4J_URL: 'bolt://localhost:7690',
  NEO4J_USER: 'neo4j',
  NEO4J_PASSWORD: 'rdi-dev-password',
  REDIS_URL: 'redis://localhost:6391',
  NODE_ENV: 'development',
  APP_URL: 'http://localhost:5177',
  RDI_DEV_ROUTES: 'false',
  COOKIE_SECURE: 'true',
  RATE_LIMIT_PREFIX: 'rl',
  RATE_LIMITS: 'on',
  DB_ENSURE: 'false',
  TRUST_PROXY: 'false',
  DEMO_REPOS: 'true',
};

const PRODUCTION = 'production';
const HOP_COUNT = /^\d+$/;

const parseTrustProxy = (value: string): boolean | number | string => {
  if (value === 'true') return true;
  if (value === 'false' || value === '') return false;
  return HOP_COUNT.test(value) ? Number(value) : value;
};

const readGithub = (env: NodeJS.ProcessEnv): Config['github'] => {
  const { GITHUB_APP_ID, GITHUB_APP_PRIVATE_KEY, GITHUB_APP_SLUG, GITHUB_WEBHOOK_SECRET, GITHUB_STATE_SECRET } = env;
  if (!GITHUB_APP_ID || !GITHUB_APP_PRIVATE_KEY || !GITHUB_APP_SLUG || !GITHUB_WEBHOOK_SECRET || !GITHUB_STATE_SECRET) return null;
  return { appId: GITHUB_APP_ID, privateKey: GITHUB_APP_PRIVATE_KEY.replace(/\\n/g, '\n'), slug: GITHUB_APP_SLUG, webhookSecret: GITHUB_WEBHOOK_SECRET, stateSecret: GITHUB_STATE_SECRET };
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const read = (key: keyof typeof DEFAULTS) => env[key] ?? DEFAULTS[key];
  const nodeEnv = read('NODE_ENV');
  const production = nodeEnv === PRODUCTION;
  return {
    port: Number(read('API_PORT')),
    databaseUrl: read('DATABASE_URL'),
    neo4jUrl: read('NEO4J_URL'),
    neo4jUser: read('NEO4J_USER'),
    neo4jPassword: read('NEO4J_PASSWORD'),
    redisUrl: read('REDIS_URL'),
    nodeEnv,
    appUrl: read('APP_URL'),
    devRoutes: !production && read('RDI_DEV_ROUTES') === 'true',
    cookieSecure: production || read('COOKIE_SECURE') !== 'false',
    rateLimitPrefix: read('RATE_LIMIT_PREFIX'),
    rateLimitsEnabled: production || read('RATE_LIMITS') !== 'off',
    dbEnsure: read('DB_ENSURE') === 'true',
    trustProxy: parseTrustProxy(read('TRUST_PROXY')),
    demoRepos: !production && read('DEMO_REPOS') !== 'false',
    github: readGithub(env),
  };
};
