import { hash, verify } from '@node-rs/argon2';

export const MIN_PASSWORD_LENGTH = 12;

const COMMON_PASSWORDS = new Set([
  'password1234', '123456789012', 'qwertyuiopas', 'letmein12345', 'iloveyou1234', 'passwordpassword',
  'admin1234567', 'welcome12345', 'qwerty123456', '111111111111', 'abcdefghijkl', 'changeme1234',
]);

export const passwordProblem = (password: string): 'too_short' | 'too_common' | null => {
  if (password.length < MIN_PASSWORD_LENGTH) return 'too_short';
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return 'too_common';
  return null;
};

export const hashPassword = (password: string): Promise<string> => hash(password);

export const verifyPassword = async (passwordHash: string, password: string): Promise<boolean> => {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
};
