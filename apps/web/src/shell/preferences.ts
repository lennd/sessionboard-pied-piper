import { LEVELS, type Level } from '@rdi/scene';
import type { UiLanguage } from '../i18n/messages';
import { resolveTheme, type ThemeId } from '../theme/themes';
import type { Prefs } from './local';

const DEFAULT_LEVEL: Level = 'architecture';
export const EMPTY_PREFS: Prefs = { uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null };

export const effectiveUiLanguage = (prefs: Prefs | undefined, fallback: UiLanguage): UiLanguage => prefs?.uiLanguage ?? fallback;

export const effectiveExplanationLanguage = (prefs: Prefs | undefined, ui: UiLanguage): UiLanguage => prefs?.explanationLanguage ?? prefs?.uiLanguage ?? ui;

export const effectiveTheme = (prefs: Prefs | undefined): ThemeId => resolveTheme(prefs?.theme ?? null);

export const effectiveLevel = (prefs: Prefs | undefined): Level =>
  prefs?.initialLevel && (LEVELS as readonly string[]).includes(prefs.initialLevel) ? prefs.initialLevel : DEFAULT_LEVEL;
