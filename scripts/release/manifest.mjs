#!/usr/bin/env node
// Turns the GitHub Releases of the repository into the releases.json the download page reads.
//   gh api "repos/OWNER/REPO/releases?per_page=100" | node scripts/release/manifest.mjs --out apps/landing/dist/releases.json
// Checksums come from the checksums.txt asset each release carries (written by the Release workflow).
import { readFile, writeFile } from 'node:fs/promises';

const KINDS = { '.dmg': 'dmg', '.zip': 'zip' };
const ARCH = /-(arm64|x64|universal)\.(dmg|zip)$/;
const CHECKSUMS_ASSET = 'checksums.txt';
const TAG = /^v(\d+\.\d+\.\d+(?:[-+][\w.]+)?)$/;

const args = (argv) => {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    if (!key.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) out[key.slice(2)] = true;
    else { out[key.slice(2)] = next; i += 1; }
  }
  return out;
};

/** GitHub stores asset names with dots where the file had spaces; compare names with both folded. */
export const assetKey = (name) => name.replace(/[\s.]+/g, '.');

/** `sha256  file name` lines → map by folded file name. */
export const parseChecksums = (text) =>
  new Map(text.split('\n').map((line) => line.trim()).filter(Boolean).map((line) => {
    const [hash, ...name] = line.split(/\s+/);
    return [assetKey(name.join(' ').replace(/^\*/, '')), hash];
  }));

/** One manifest release per published GitHub release whose tag is a version; drafts and prereleases without assets are skipped. */
export const fromGithubReleases = (releases, checksumsByTag = new Map()) =>
  releases
    .filter((r) => !r.draft && TAG.test(r.tag_name))
    .map((r) => {
      const version = TAG.exec(r.tag_name)[1];
      const sums = checksumsByTag.get(r.tag_name) ?? new Map();
      const files = (r.assets ?? [])
        .filter((a) => Object.keys(KINDS).some((ext) => a.name.endsWith(ext)))
        .map((a) => ({ name: a.name, url: a.browser_download_url, kind: KINDS[Object.keys(KINDS).find((ext) => a.name.endsWith(ext))], arch: ARCH.exec(a.name)?.[1] ?? 'arm64', size: a.size, sha256: sums.get(assetKey(a.name)) ?? '' }));
      return { version, date: r.published_at ?? r.created_at, ...(r.body?.trim() ? { notes: r.body.trim() } : {}), ...(r.prerelease ? { prerelease: true } : {}), files };
    })
    .filter((r) => r.files.length > 0);

/** The checksums.txt asset of each release, fetched with the given function (so tests can stub it). */
export const checksumsFor = async (releases, fetchText) => {
  const byTag = new Map();
  for (const release of releases) {
    const asset = (release.assets ?? []).find((a) => a.name === CHECKSUMS_ASSET);
    if (!asset) continue;
    try {
      byTag.set(release.tag_name, parseChecksums(await fetchText(asset.browser_download_url)));
    } catch {
      // a release without readable checksums still lists its files
    }
  }
  return byTag;
};

const readStdin = async () => {
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8');
};

const main = async () => {
  const opts = args(process.argv.slice(2));
  if (!opts.out) {
    console.error('usage: gh api repos/OWNER/REPO/releases | manifest.mjs --out <file> [--in <releases.json from the API>] [--product "Pied Piper"]');
    process.exit(2);
  }
  const raw = opts.in ? await readFile(opts.in, 'utf8') : await readStdin();
  const releases = JSON.parse(raw);
  const checksums = await checksumsFor(releases, async (url) => {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`checksums ${response.status}`);
    return response.text();
  });
  const manifest = { product: opts.product ?? 'Pied Piper', platform: 'darwin-arm64', generatedAt: new Date().toISOString(), releases: fromGithubReleases(releases, checksums) };
  await writeFile(opts.out, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`manifest ${opts.out}: ${manifest.releases.length} release(s)`);
};

if (import.meta.url === `file://${process.argv[1]}`) await main();
