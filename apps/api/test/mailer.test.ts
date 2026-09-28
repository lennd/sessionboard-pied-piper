import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';
import { createMailer } from '../src/mail/mailer';

describe('createMailer', () => {
  it('uses the dev mailer outside production', () => {
    expect(typeof createMailer(loadConfig({})).send).toBe('function');
  });

  it('refuses to start in production without a real mailer', () => {
    expect(() => createMailer(loadConfig({ NODE_ENV: 'production' }))).toThrow(/mailer/);
  });
});
