import { LEVELS } from '@rdi/scene';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../http/deps';
import { readPrefs, updatePrefs } from '../store/prefs';

const LANGUAGES = ['en', 'es', 'pt'] as const;
const THEMES = ['piper', 'mission', 'studio', 'paper', 'contrast'] as const;
const patchBody = z.object({
  uiLanguage: z.enum(LANGUAGES).nullable().optional(),
  explanationLanguage: z.enum(LANGUAGES).nullable().optional(),
  theme: z.enum(THEMES).nullable().optional(),
  initialLevel: z.enum(LEVELS).nullable().optional(),
});

export const prefsRoutes = (api: FastifyInstance, deps: AppDeps) => {
  api.get('/prefs', async () => readPrefs(deps.config.home));
  api.patch('/prefs', async (req) => updatePrefs(deps.config.home, patchBody.parse(req.body)));
};
