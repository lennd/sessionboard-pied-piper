import { join } from 'node:path';
import { readJson, writeJson } from './json';

export type Signature = { logoUrl: string | null };
const FILE = 'signature.json';

export const readSignature = (home: string): Promise<Signature> => readJson<Signature>(join(home, FILE), { logoUrl: null });
export const writeSignature = (home: string, signature: Signature): Promise<void> => writeJson(join(home, FILE), signature);
