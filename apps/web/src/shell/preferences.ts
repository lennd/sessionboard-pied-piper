import { LEVELS, type Level } from '@rdi/scene';
import type { UiLanguage } from '../i18n/messages';
import { resolveTheme, type ThemeId } from '../theme/themes';
import type { SessionOrg, SessionUser } from './session';

const DEFAULT_LEVEL: Level = 'architecture';

export const effectiveUiLanguage = (user: SessionUser, org: SessionOrg | null, fallback: UiLanguage): UiLanguage =>
  user.uiLanguage ?? org?.defaultUiLanguage ?? fallback;

export const effectiveExplanationLanguage = (user: SessionUser, org: SessionOrg | null, ui: UiLanguage): UiLanguage =>
  user.explanationLanguage ?? org?.defaultExplanationLanguage ?? ui;

export const effectiveTheme = (user: SessionUser, org: SessionOrg | null): ThemeId => resolveTheme(user.theme, org?.defaultTheme);

export const effectiveLevel = (user: SessionUser): Level =>
  user.initialLevel && (LEVELS as readonly string[]).includes(user.initialLevel) ? user.initialLevel : DEFAULT_LEVEL;

export const safeNext = (next: string | null): string => (next && next.startsWith('/') && !next.startsWith('//') ? next : '/');
