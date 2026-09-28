import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5177' },
  workers: 1,
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../api',
      url: 'http://localhost:4040/health',
      reuseExistingServer: false,
      timeout: 90_000,
      env: {
        RDI_DEV_ROUTES: 'true',
        DATABASE_URL: 'postgres://rdi:rdi@localhost:5548/rdi_e2e',
        DB_ENSURE: 'true',
        REDIS_URL: 'redis://localhost:6391/2',
        RATE_LIMITS: 'off',
      },
    },
    { command: 'npm run dev', url: 'http://localhost:5177', reuseExistingServer: false, timeout: 60_000 },
  ],
});
