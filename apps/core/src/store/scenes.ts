import { randomUUID } from 'node:crypto';
import type { Scene } from '@rdi/scene';
import { join } from 'node:path';
import { listJson, readJson, writeJson } from './json';

export type SceneFile = { id: string; conversationId: string | null; sourceSceneId: string | null; turn: number; scene: Scene; createdAt: string };

const DIR = 'scenes';
const SYSTEM_MAP_PREFIX = 'system-map';
export const SYSTEM_MAP_ID = 'system-map';
const NO_GIT = 'nogit';

const file = (dir: string, id: string) => join(dir, DIR, `${id}.json`);
const mapFile = (dir: string, head: string | null) => join(dir, `${SYSTEM_MAP_PREFIX}.${head ?? NO_GIT}.json`);

export const insertScene = async (dir: string, now: Date, input: Omit<SceneFile, 'id' | 'createdAt'>): Promise<SceneFile> => {
  const row: SceneFile = { id: randomUUID(), createdAt: now.toISOString(), ...input };
  await writeJson(file(dir, row.id), row);
  return row;
};

export const findScene = (dir: string, id: string): Promise<SceneFile | null> => readJson<SceneFile | null>(file(dir, id), null);

export const listConversationScenes = async (dir: string, conversationId: string): Promise<SceneFile[]> =>
  (await listJson<SceneFile>(join(dir, DIR))).filter((s) => s.conversationId === conversationId).sort((a, b) => a.turn - b.turn || a.createdAt.localeCompare(b.createdAt));

export const readSystemMap = (dir: string, head: string | null): Promise<Scene | null> => readJson<Scene | null>(mapFile(dir, head), null);

export const writeSystemMap = (dir: string, head: string | null, scene: Scene): Promise<void> => writeJson(mapFile(dir, head), scene);
