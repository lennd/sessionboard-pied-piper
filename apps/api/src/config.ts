export type Config = {
  port: number;
  databaseUrl: string;
  neo4jUrl: string;
  neo4jUser: string;
  neo4jPassword: string;
  redisUrl: string;
};

const DEFAULTS = {
  API_PORT: '4040',
  DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi',
  NEO4J_URL: 'bolt://localhost:7690',
  NEO4J_USER: 'neo4j',
  NEO4J_PASSWORD: 'rdi-dev-password',
  REDIS_URL: 'redis://localhost:6391',
};

export const loadConfig = (env: NodeJS.ProcessEnv = process.env): Config => {
  const read = (key: keyof typeof DEFAULTS) => env[key] ?? DEFAULTS[key];
  return {
    port: Number(read('API_PORT')),
    databaseUrl: read('DATABASE_URL'),
    neo4jUrl: read('NEO4J_URL'),
    neo4jUser: read('NEO4J_USER'),
    neo4jPassword: read('NEO4J_PASSWORD'),
    redisUrl: read('REDIS_URL'),
  };
};
