// @ts-check
/**
 * @typedef {{ name: string; url: string; kind: 'dmg' | 'zip'; arch: string; size: number; sha256: string }} ReleaseFile
 * @typedef {{ version: string; date: string; notes?: string; files: ReleaseFile[] }} Release
 * @typedef {{ product: string; platform: string; releases: Release[]; generatedAt?: string }} Manifest
 */

const MB = 1024 * 1024;
const KIND_LABEL = { dmg: 'Instalador .dmg', zip: 'Archivo .zip' };

/** @param {number} bytes */
export const formatSize = (bytes) => `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;

/** @param {string} iso @param {string} [locale] */
export const formatDate = (iso, locale = 'es') => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });

/** Newest first, by semantic version then date. @param {Release[]} releases */
export const sortReleases = (releases) =>
  [...releases].sort((a, b) => compareVersions(b.version, a.version) || b.date.localeCompare(a.date));

/** @param {string} a @param {string} b */
export const compareVersions = (a, b) => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** The installer of a release, falling back to its first file. @param {Release} release */
export const installerOf = (release) => release.files.find((f) => f.kind === 'dmg') ?? release.files[0] ?? null;

/** @param {Release} release */
export const renderLatest = (release) => {
  const installer = installerOf(release);
  if (!installer) return '<p class="muted">La última versión no tiene archivos para descargar.</p>';
  return `<a class="download" href="${installer.url}" download data-testid="download-latest">⤓ Descargar Pied Piper ${esc(release.version)}</a>
<div class="latest-meta"><span>macOS · Apple Silicon</span><span>${formatSize(installer.size)}</span><span>${formatDate(release.date)}</span></div>`;
};

/** @param {Release} release */
export const renderRelease = (release) => `<li class="release" data-version="${esc(release.version)}">
  <div>
    <div class="release-head"><span class="release-version">${esc(release.version)}</span><span class="release-date">${formatDate(release.date)}</span></div>
    <p class="release-notes">${esc(release.notes ?? '')}</p>
  </div>
  <div class="release-files">${release.files.map((f) => `<a href="${f.url}" download title="sha256 ${f.sha256}">${KIND_LABEL[f.kind] ?? f.name} <small>${formatSize(f.size)}</small></a>`).join('')}</div>
</li>`;

/** @param {Manifest} manifest */
export const renderPage = (manifest) => {
  const releases = sortReleases(manifest.releases);
  const latest = releases[0];
  return {
    latest: latest ? renderLatest(latest) : '<p class="muted">Todavía no hay versiones publicadas.</p>',
    list: releases.map(renderRelease).join(''),
    empty: releases.length === 0,
    note: manifest.generatedAt ? `Lista actualizada el ${formatDate(manifest.generatedAt)}.` : '',
  };
};

/** @param {string} text */
const esc = (text) => text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] ?? c);
