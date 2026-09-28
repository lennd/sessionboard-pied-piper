import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { environment: 'node', testTimeout: 120_000, include: ['test/**/*.integration.test.ts'], globalSetup: ['./test/setup/globalSetup.ts'], fileParallelism: false },
});
