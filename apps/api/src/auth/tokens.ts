import { createHash, randomBytes } from 'node:crypto';

const DEFAULT_TOKEN_BYTES = 32;

export const randomToken = (bytes = DEFAULT_TOKEN_BYTES): string => randomBytes(bytes).toString('base64url');

export const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');
