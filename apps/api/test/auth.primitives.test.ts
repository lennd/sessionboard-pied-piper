import { describe, expect, it } from 'vitest';
import { hashPassword, passwordProblem, verifyPassword } from '../src/auth/password';
import { hashToken, randomToken } from '../src/auth/tokens';
import { can } from '../src/domain/roles';

describe('passwords', () => {
  it('rejects short and common passwords', () => {
    expect(passwordProblem('short')).toBe('too_short');
    expect(passwordProblem('Password1234')).toBe('too_common');
    expect(passwordProblem('correct horse battery')).toBeNull();
  });

  it('hashes with argon2id and verifies', async () => {
    const hash = await hashPassword('correct horse battery');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery')).toBe(true);
    expect(await verifyPassword(hash, 'wrong horse battery')).toBe(false);
    expect(await verifyPassword('not-a-hash', 'x')).toBe(false);
  });
});

describe('tokens', () => {
  it('creates url-safe random tokens and stable hashes', () => {
    const a = randomToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(randomToken()).not.toBe(a);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});

describe('roles', () => {
  it('follows the permission matrix', () => {
    expect(can('owner', 'org.delete')).toBe(true);
    expect(can('admin', 'org.delete')).toBe(false);
    expect(can('admin', 'members.manage')).toBe(true);
    expect(can('member', 'members.manage')).toBe(false);
    expect(can('member', 'explore')).toBe(true);
    expect(can('admin', 'ownership.transfer')).toBe(false);
  });
});
