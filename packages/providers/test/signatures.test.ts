import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { signState, verifyState, verifyWebhookSignature } from '../src/index';

describe('verifyWebhookSignature', () => {
  const body = '{"zen":"hi"}';
  const good = `sha256=${createHmac('sha256', 'whsec').update(body).digest('hex')}`;
  it('accepts the right signature and rejects wrong, malformed or missing ones', () => {
    expect(verifyWebhookSignature('whsec', body, good)).toBe(true);
    expect(verifyWebhookSignature('other', body, good)).toBe(false);
    expect(verifyWebhookSignature('whsec', `${body} `, good)).toBe(false);
    expect(verifyWebhookSignature('whsec', body, 'sha256=zz')).toBe(false);
    expect(verifyWebhookSignature('whsec', body, undefined)).toBe(false);
  });
});

describe('install state', () => {
  const now = new Date('2026-09-28T12:00:00Z');
  it('round-trips the org id and rejects tampering and expiry', () => {
    const state = signState('secret', 'org-1', now);
    expect(verifyState('secret', state, now)).toBe('org-1');
    expect(verifyState('other', state, now)).toBeNull();
    expect(verifyState('secret', state.replace('org-1', 'org-2'), now)).toBeNull();
    expect(verifyState('secret', state, new Date(now.getTime() + 16 * 60_000))).toBeNull();
    expect(verifyState('secret', 'garbage', now)).toBeNull();
  });
});
