import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const RULES_FILE = 'rules.md';
export const MAX_RULES_CHARS = 20_000;
const file = (dir: string) => join(dir, RULES_FILE);

/** Free-text validation rules the team wants the agent to check, one per line; stored next to the scenes so the repository can share them. */
export const readRules = async (dir: string): Promise<string> => {
  try {
    return (await readFile(file(dir), 'utf8')).trimEnd();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

export const writeRules = async (dir: string, text: string): Promise<string> => {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  await mkdir(dirname(file(dir)), { recursive: true });
  await writeFile(file(dir), normalized ? `${normalized}\n` : '');
  return normalized;
};

/** The non-empty, non-comment lines of the rules text. */
export const ruleLines = (text: string): string[] =>
  text.split('\n').map((l) => l.replace(/^\s*(?:[-*]|\d+[.)])\s+/, '').trim()).filter((l) => l && !l.startsWith('#'));
