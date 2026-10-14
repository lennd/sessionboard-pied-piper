/* Names the development Electron bundle after the app: macOS reads the Dock title from the bundle's Info.plist, not from app.setName(). Idempotent; only touches node_modules. */
const { readFileSync, writeFileSync, existsSync } = require('node:fs');
const { dirname, join } = require('node:path');

const NAME = 'Pied Piper';
const KEYS = ['CFBundleName', 'CFBundleDisplayName'];

const plistOf = () => {
  const binary = require('electron');
  const plist = join(dirname(binary), '..', 'Info.plist');
  return existsSync(plist) ? plist : null;
};

const rename = (plist) => {
  const before = readFileSync(plist, 'utf8');
  const after = KEYS.reduce((text, key) => text.replace(new RegExp(`(<key>${key}</key>\\s*<string>)[^<]*(</string>)`), `$1${NAME}$2`), before);
  if (after !== before) writeFileSync(plist, after);
};

if (process.platform === 'darwin') {
  const plist = plistOf();
  if (plist) rename(plist);
}
