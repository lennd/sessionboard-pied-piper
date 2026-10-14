import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import { delimiter, join } from 'node:path';

const DEV = process.env.RDI_DEV === '1';
const WEB_DEV_URL = process.env.RDI_WEB_URL ?? 'http://localhost:5177';
const LISTENING = /listening on http:\/\/127\.0\.0\.1:(\d+)/;
const CORE_TIMEOUT_MS = 60_000;
const WINDOW = { width: 1480, height: 920, minWidth: 980, minHeight: 640 };
const EXTRA_PATH = ['/opt/homebrew/bin', '/usr/local/bin', join(app.getPath('home'), '.local', 'bin'), join(app.getPath('home'), '.npm-global', 'bin')];

let core: ChildProcess | null = null;
app.setName('Pied Piper');

/** Apps launched from Finder get a minimal PATH; add the places where git and claude usually live. */
const augmentedPath = () => [...new Set([...(process.env.PATH ?? '').split(delimiter), ...EXTRA_PATH])].filter(Boolean).join(delimiter);

const coreCommand = (): { args: string[]; env: NodeJS.ProcessEnv } => {
  const env: NodeJS.ProcessEnv = { ...process.env, ELECTRON_RUN_AS_NODE: '1', RDI_PORT: '0', RDI_HOST: '127.0.0.1', PATH: augmentedPath() };
  if (DEV) {
    const root = join(__dirname, '..', '..', '..');
    return { args: [join(root, 'node_modules', 'tsx', 'dist', 'cli.mjs'), join(root, 'apps', 'core', 'src', 'server.ts')], env };
  }
  env.RDI_WEB_DIST = join(process.resourcesPath, 'web');
  return { args: [join(process.resourcesPath, 'core', 'server.mjs')], env };
};

const startCore = (): Promise<number> =>
  new Promise((resolve, reject) => {
    const { args, env } = coreCommand();
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
    core = child;
    const timer = setTimeout(() => reject(new Error('the local core did not start in time')), CORE_TIMEOUT_MS);
    child.stdout?.on('data', (chunk: Buffer) => {
      const text = String(chunk);
      process.stdout.write(`[core] ${text}`);
      const match = LISTENING.exec(text);
      if (match) {
        clearTimeout(timer);
        resolve(Number(match[1]));
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => process.stderr.write(`[core] ${String(chunk)}`));
    child.on('exit', (code) => {
      clearTimeout(timer);
      core = null;
      reject(new Error(`the local core exited with code ${code}`));
    });
  });

const createWindow = async (port: number) => {
  const window = new BrowserWindow({ ...WINDOW, title: 'Pied Piper', icon: join(__dirname, '..', 'build', 'icon.png'), webPreferences: { preload: join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false } });
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: 'deny' };
  });
  await window.loadURL(DEV ? WEB_DEV_URL : `http://127.0.0.1:${port}`);
  console.log(`[desktop] window loaded (${DEV ? WEB_DEV_URL : `core on ${port}`})`);
};

ipcMain.handle('rdi:pick-folder', async () => {
  const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
  return result.canceled ? null : (result.filePaths[0] ?? null);
});
ipcMain.handle('rdi:open-external', (_event, url: string) => shell.openExternal(url));

app.whenReady().then(async () => {
  if (process.platform === 'darwin') app.dock?.setIcon(join(__dirname, '..', 'build', 'icon.png'));
  try {
    const port = await startCore();
    await createWindow(port);
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) void createWindow(port);
    });
  } catch (error) {
    dialog.showErrorBox('Pied Piper', error instanceof Error ? error.message : String(error));
    app.quit();
  }
});

app.on('window-all-closed', () => app.quit());
app.on('before-quit', () => core?.kill());
