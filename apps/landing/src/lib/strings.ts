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
    featuresTitle: 'What it does',
    allVersions: 'All versions on GitHub',
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
    featuresTitle: 'Qué hace',
    allVersions: 'Todas las versiones en GitHub',
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

export type Feature = { icon: 'map' | 'walk' | 'pull' | 'sessions' | 'chat' | 'feature' | 'local'; title: string; text: string };

/** The capabilities shown on the download page, in the order a new user meets them. */
export const FEATURES: Record<Lang, Feature[]> = {
  en: [
    { icon: 'map', title: 'A map of each repository', text: 'One click asks Claude to draw the architecture: pieces, flows, risks and how it behaves at scale. Cached per commit, with the logos of the products each piece runs on.' },
    { icon: 'walk', title: 'Animated walkthroughs', text: 'Follow a real request step by step. The camera moves with it, data shows up where it is kept, and loops are marked on the pieces that repeat.' },
    { icon: 'pull', title: 'Pull requests on the map', text: 'See what a pull request touches and could break, with risks anchored to the exact lines. Comment them on GitHub with evidence, approve or request changes, and chat about the change without leaving it.' },
    { icon: 'sessions', title: 'Your Claude Code sessions', text: 'Every session you run in that folder appears as a timeline: prompts, edits, commands and tests, with its changes overlaid on the map at zero cost.' },
    { icon: 'chat', title: 'Chat, plan, run', text: 'Ask how something works or plan a change. Plans become versioned solutions that Claude Code implements from the app, asking for approval before anything risky.' },
    { icon: 'feature', title: 'Features across repositories', text: 'Describe a change that spans API, UI and pipelines. Pied Piper plans it per repository, with dependencies between tasks, and runs it repo by repo.' },
    { icon: 'local', title: 'Local and private', text: 'Everything runs on your Mac with your own Claude Code login. Maps, chats and plans are JSON files inside each repository, ignored by git.' },
  ],
  es: [
    { icon: 'map', title: 'Un mapa de cada repositorio', text: 'Con un clic, Claude dibuja la arquitectura: piezas, flujos, riesgos y cómo se comporta a escala. Se cachea por commit y muestra los logos de los productos sobre los que corre cada pieza.' },
    { icon: 'walk', title: 'Recorridos animados', text: 'Seguí un pedido real paso a paso. La cámara acompaña, los datos aparecen donde se guardan y los ciclos quedan marcados en las piezas que se repiten.' },
    { icon: 'pull', title: 'Pull requests sobre el mapa', text: 'Mirá qué toca y qué puede romper un pull request, con riesgos anclados a las líneas exactas. Comentalos en GitHub con evidencia, aprobá o pedí cambios, y chateá sobre el cambio sin salir de ahí.' },
    { icon: 'sessions', title: 'Tus sesiones de Claude Code', text: 'Cada sesión que corrés en esa carpeta aparece como una línea de tiempo: prompts, ediciones, comandos y tests, con sus cambios superpuestos en el mapa sin gastar tokens.' },
    { icon: 'chat', title: 'Chatear, planificar, ejecutar', text: 'Preguntá cómo funciona algo o planificá un cambio. Los planes se vuelven soluciones versionadas que Claude Code implementa desde la app, pidiendo permiso antes de cualquier acción riesgosa.' },
    { icon: 'feature', title: 'Features entre repositorios', text: 'Describí un cambio que cruza API, UI y pipelines. Pied Piper lo planifica por repositorio, con dependencias entre tareas, y lo ejecuta repo por repo.' },
    { icon: 'local', title: 'Local y privado', text: 'Todo corre en tu Mac con tu propia sesión de Claude Code. Mapas, chats y planes son archivos JSON dentro de cada repositorio, ignorados por git.' },
  ],
};

/** Spanish for Spanish browsers (or a saved choice), English for everyone else. */
export const pickLanguage = (saved: string | null, browser: readonly string[]): Lang => {
  if (saved === 'en' || saved === 'es') return saved;
  return browser.some((tag) => tag.toLowerCase().startsWith('es')) ? 'es' : 'en';
};

export const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (_, key: string) => values[key] ?? '');
