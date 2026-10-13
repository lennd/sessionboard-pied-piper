import { defineConfig } from '@playwright/test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const home = mkdtempSync(join(tmpdir(), 'rdi-e2e-'));

export default defineConfig({
  testDir: './e2e',
  use: { baseURL: 'http://localhost:5177' },
  workers: 1,
  webServer: [
    {
      command: 'npm run dev',
      cwd: '../core',
      url: 'http://127.0.0.1:4040/api/health',
      reuseExistingServer: false,
      timeout: 90_000,
      env: { RDI_HOME: home, RDI_FAKE_AGENT: 'true', RDI_PORT: '4040' },
    },
    { command: 'npm run dev', cwd: '.', url: 'http://localhost:5177', reuseExistingServer: false, timeout: 90_000 },
  ],
});
