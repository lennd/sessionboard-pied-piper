import { getViteConfig } from 'astro/config';
export default getViteConfig({ test: { environment: 'node', include: ['test/**/*.test.ts'], globals: true } });
