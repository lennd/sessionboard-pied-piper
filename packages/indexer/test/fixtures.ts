import { fileURLToPath } from 'node:url';

export const FIXTURES_DIR = fileURLToPath(new URL('../../../fixtures/repos', import.meta.url));
export const fixture = (name: 'shop-web' | 'shop-api' | 'shop-worker') => `${FIXTURES_DIR}/${name}`;
