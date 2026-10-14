import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const TOOLKIT_FILE = 'toolkit.md';
export const MAX_TOOLKIT_CHARS = 20_000;
const file = (dir: string) => join(dir, TOOLKIT_FILE);

/** Free-text description of the harness the team uses in this repository: what to install when missing and which commands to prefer. */
export const readToolkit = async (dir: string): Promise<string> => {
  try {
    return (await readFile(file(dir), 'utf8')).trimEnd();
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw error;
  }
};

export const writeToolkit = async (dir: string, text: string): Promise<string> => {
  const normalized = text.replace(/\r\n/g, '\n').trimEnd();
  await mkdir(dirname(file(dir)), { recursive: true });
  await writeFile(file(dir), normalized ? `${normalized}\n` : '');
  return normalized;
};
