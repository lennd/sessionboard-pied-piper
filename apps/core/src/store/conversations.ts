import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { listJson, readJson, withLock, writeJson } from './json';

export type StoredMessage = { role: 'user' | 'assistant'; content: unknown; excluded?: boolean };
export type Usage = { input: number; output: number; costUsd: number };
export type ConversationFile = { id: string; title: string; createdAt: string; updatedAt: string; sdkSessionId: string | null; messages: StoredMessage[]; usage: Usage };
export type ConversationSummary = Pick<ConversationFile, 'id' | 'title' | 'createdAt' | 'updatedAt'>;

export const DEFAULT_CONVERSATION_TITLE = 'New conversation';
const DIR = 'conversations';
const EMPTY_USAGE: Usage = { input: 0, output: 0, costUsd: 0 };

const file = (dir: string, id: string) => join(dir, DIR, `${id}.json`);
const summary = (c: ConversationFile): ConversationSummary => ({ id: c.id, title: c.title, createdAt: c.createdAt, updatedAt: c.updatedAt });

export const createConversation = async (dir: string, now: Date, title = DEFAULT_CONVERSATION_TITLE): Promise<ConversationFile> => {
  const stamp = now.toISOString();
  const conversation: ConversationFile = { id: randomUUID(), title, createdAt: stamp, updatedAt: stamp, sdkSessionId: null, messages: [], usage: { ...EMPTY_USAGE } };
  await writeJson(file(dir, conversation.id), conversation);
  return conversation;
};

export const listConversations = async (dir: string): Promise<ConversationSummary[]> =>
  (await listJson<ConversationFile>(join(dir, DIR))).map(summary).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));

export const findConversation = (dir: string, id: string): Promise<ConversationFile | null> => readJson<ConversationFile | null>(file(dir, id), null);

const update = (dir: string, id: string, now: Date, change: (c: ConversationFile) => ConversationFile): Promise<ConversationFile> =>
  withLock(file(dir, id), async () => {
    const current = await findConversation(dir, id);
    if (!current) throw new Error(`conversation ${id} not found`);
    const next = { ...change(current), updatedAt: now.toISOString() };
    await writeJson(file(dir, id), next);
    return next;
  });

export const appendMessages = (dir: string, id: string, now: Date, messages: StoredMessage[]): Promise<ConversationFile> =>
  update(dir, id, now, (c) => ({ ...c, messages: [...c.messages, ...messages] }));

export const renameConversation = (dir: string, id: string, now: Date, title: string): Promise<ConversationFile> => update(dir, id, now, (c) => ({ ...c, title }));

export const recordRun = (dir: string, id: string, now: Date, run: { sdkSessionId: string | null; usage: Usage }): Promise<ConversationFile> =>
  update(dir, id, now, (c) => ({
    ...c,
    sdkSessionId: run.sdkSessionId ?? c.sdkSessionId,
    usage: { input: c.usage.input + run.usage.input, output: c.usage.output + run.usage.output, costUsd: c.usage.costUsd + run.usage.costUsd },
  }));

export const totalUsage = async (dir: string): Promise<Usage> =>
  (await listJson<ConversationFile>(join(dir, DIR))).reduce<Usage>(
    (sum, c) => ({ input: sum.input + c.usage.input, output: sum.output + c.usage.output, costUsd: sum.costUsd + c.usage.costUsd }),
    { ...EMPTY_USAGE },
  );
