// Copies the static site into dist/ (the sample manifest stays out: the real one lives in the bucket).
import { cp, mkdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = `${root}src`;
const dist = `${root}dist`;
await rm(dist, { recursive: true, force: true });
await mkdir(dist, { recursive: true });
await cp(src, dist, { recursive: true, filter: (path) => !path.endsWith('releases.json') });
console.log(`landing built in ${dist}`);
