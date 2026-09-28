import { createHmac, timingSafeEqual } from 'node:crypto';

const STATE_MAX_AGE_MS = 15 * 60_000;
const SIGNATURE_PREFIX = 'sha256=';

const safeEqual = (a: string, b: string) => {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};

export const verifyWebhookSignature = (secret: string, payload: string, header: string | undefined): boolean => {
  if (!header || !header.startsWith(SIGNATURE_PREFIX)) return false;
  const expected = `${SIGNATURE_PREFIX}${createHmac('sha256', secret).update(payload).digest('hex')}`;
  return safeEqual(expected, header);
};

const stateMac = (secret: string, orgId: string, issuedAt: number) => createHmac('sha256', secret).update(`${orgId}.${issuedAt}`).digest('base64url');

export const signState = (secret: string, orgId: string, now: Date = new Date()): string => {
  const issuedAt = now.getTime();
  return `${orgId}.${issuedAt}.${stateMac(secret, orgId, issuedAt)}`;
};

export const verifyState = (secret: string, state: string, now: Date = new Date(), maxAgeMs = STATE_MAX_AGE_MS): string | null => {
  const [orgId, issuedAtText, mac] = state.split('.');
  const issuedAt = Number(issuedAtText);
  if (!orgId || !mac || !Number.isFinite(issuedAt)) return null;
  if (!safeEqual(stateMac(secret, orgId, issuedAt), mac)) return null;
  return now.getTime() - issuedAt <= maxAgeMs && issuedAt <= now.getTime() ? orgId : null;
};
