export type Lang = 'en' | 'es';
export const LANGS: readonly Lang[] = ['en', 'es'];
export const STORAGE_KEY = 'piedpiper.lang';

export const STRINGS = {
  en: {
    locale: 'en-US',
    title: 'Pied Piper · downloads',
    description: 'Download Pied Piper, the desktop companion for Claude Code that draws the map of your repositories.',
    tagline: 'The map of your repositories and what each change touches, without reading code. Runs on your Mac with your own Claude Code session.',
    download: 'Download Pied Piper {version}',
    platform: 'macOS · Apple Silicon',
    allVersions: 'All versions',
    noVersions: 'No versions published yet.',
    noFiles: 'The latest version has no files to download.',
    installTitle: 'How to install',
    step1: 'Open the <code>.dmg</code> and drag <b>Pied Piper</b> to Applications.',
    step2: 'The first time, macOS may ask you to confirm in <b>Privacy &amp; Security</b>: the app is not signed with a Developer ID.',
    step3: 'You need <code>claude</code> signed in and <code>gh</code> for pull requests. The app checks both when it opens.',
    onlyMac: 'macOS with Apple Silicon only.',
    updated: 'List updated on {date}.',
    dmg: 'Installer .dmg',
    zip: 'Archive .zip',
    prerelease: 'pre-release',
    language: 'Language',
  },
  es: {
    locale: 'es-AR',
    title: 'Pied Piper · descargas',
    description: 'Descargá Pied Piper, el compañero de escritorio para Claude Code que dibuja el mapa de tus repositorios.',
    tagline: 'El mapa de tus repositorios y lo que toca cada cambio, sin leer código. Corre en tu Mac, con tu propia sesión de Claude Code.',
    download: 'Descargar Pied Piper {version}',
    platform: 'macOS · Apple Silicon',
    allVersions: 'Todas las versiones',
    noVersions: 'Todavía no hay versiones publicadas.',
    noFiles: 'La última versión no tiene archivos para descargar.',
    installTitle: 'Cómo instalar',
    step1: 'Abrí el archivo <code>.dmg</code> y arrastrá <b>Pied Piper</b> a Aplicaciones.',
    step2: 'La primera vez, macOS puede pedir confirmar la apertura en <b>Privacidad y seguridad</b>: la app no está firmada con un Developer ID.',
    step3: 'Necesitás <code>claude</code> con sesión iniciada y <code>gh</code> para los pull requests. La app lo verifica al abrir.',
    onlyMac: 'Solo macOS con Apple Silicon.',
    updated: 'Lista actualizada el {date}.',
    dmg: 'Instalador .dmg',
    zip: 'Archivo .zip',
    prerelease: 'versión previa',
    language: 'Idioma',
  },
} as const satisfies Record<Lang, Record<string, string>>;

export type Strings = (typeof STRINGS)[Lang];

/** Spanish for Spanish browsers (or a saved choice), English for everyone else. */
export const pickLanguage = (saved: string | null, browser: readonly string[]): Lang => {
  if (saved === 'en' || saved === 'es') return saved;
  return browser.some((tag) => tag.toLowerCase().startsWith('es')) ? 'es' : 'en';
};

export const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
