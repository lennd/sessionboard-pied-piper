export const THEMES = ['mission', 'studio', 'paper', 'contrast'] as const;
export type ThemeId = (typeof THEMES)[number];
export const THEME_STORAGE_KEY = 'rdi.theme';

type ThemeToken =
  | '--bg' | '--panel' | '--grid' | '--line' | '--text' | '--muted' | '--accent' | '--token'
  | '--ok' | '--strained' | '--limit' | '--saturated' | '--font' | '--radius';

const MONO = 'ui-monospace, SFMono-Regular, Menlo, monospace';
const SANS = 'Inter, system-ui, -apple-system, sans-serif';
const LIGHT_THEMES = new Set<ThemeId>(['paper']);

export const themeTokens: Record<ThemeId, Record<ThemeToken, string>> = {
  mission: {
    '--bg': '#05070b', '--panel': '#07120e', '--grid': '#0a1410', '--line': '#1d5a4a', '--text': '#d7fbe8', '--muted': '#5f9a85',
    '--accent': '#2dffa6', '--token': '#ffffff', '--ok': '#2dffa6', '--strained': '#f5d90a', '--limit': '#ff8a1f', '--saturated': '#ff3b5c',
    '--font': MONO, '--radius': '2px',
  },
  studio: {
    '--bg': '#0d0f14', '--panel': '#151923', '--grid': '#161b25', '--line': '#2a3142', '--text': '#e7e9ef', '--muted': '#8d95a8',
    '--accent': '#8b7dff', '--token': '#46a6ff', '--ok': '#3ecf8e', '--strained': '#f5d90a', '--limit': '#f5a524', '--saturated': '#f25f5c',
    '--font': SANS, '--radius': '10px',
  },
  paper: {
    '--bg': '#fbf8f3', '--panel': '#ffffff', '--grid': '#f1ece3', '--line': '#e2dccf', '--text': '#2b2a33', '--muted': '#6b6a75',
    '--accent': '#ff8a5b', '--token': '#2b2a33', '--ok': '#1a9e6c', '--strained': '#c9a200', '--limit': '#e07b1f', '--saturated': '#d93a4f',
    '--font': SANS, '--radius': '12px',
  },
  contrast: {
    '--bg': '#000000', '--panel': '#000000', '--grid': '#111111', '--line': '#ffffff', '--text': '#ffffff', '--muted': '#e0e0e0',
    '--accent': '#ffea00', '--token': '#00e5ff', '--ok': '#00ff66', '--strained': '#ffea00', '--limit': '#ff9100', '--saturated': '#ff1744',
    '--font': MONO, '--radius': '0px',
  },
};

const isTheme = (value: string | null | undefined): value is ThemeId =>
  value !== null && value !== undefined && (THEMES as readonly string[]).includes(value);

export const resolveTheme = (user?: string | null, org?: string | null): ThemeId => {
  if (isTheme(user)) return user;
  if (isTheme(org)) return org;
  return 'mission';
};

export const applyTheme = (element: HTMLElement, theme: ThemeId): void => {
  Object.entries(themeTokens[theme]).forEach(([token, value]) => element.style.setProperty(token, value));
  element.dataset.theme = theme;
  element.dataset.colorScheme = LIGHT_THEMES.has(theme) ? 'light' : 'dark';
};
