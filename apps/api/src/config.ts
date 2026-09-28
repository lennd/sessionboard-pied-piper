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
};

const PRODUCTION = 'production';

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
    cookieSecure: read('COOKIE_SECURE') !== 'false',
    rateLimitPrefix: read('RATE_LIMIT_PREFIX'),
    rateLimitsEnabled: production || read('RATE_LIMITS') !== 'off',
    dbEnsure: read('DB_ENSURE') === 'true',
  };
};
