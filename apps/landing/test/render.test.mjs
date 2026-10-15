import { compareVersions, formatSize, installerOf, renderPage, sortReleases } from '../src/render.js';

const file = (kind, version) => ({ name: `Pied Piper-${version}-arm64.${kind}`, url: `./releases/${version}/x.${kind}`, kind, arch: 'arm64', size: 217_564_710, sha256: 'abc' });
const manifest = {
  product: 'Pied Piper', platform: 'darwin-arm64', generatedAt: '2026-10-15T10:00:00Z',
  releases: [
    { version: '0.1.0', date: '2026-10-14T10:00:00Z', notes: 'First <build>', files: [file('dmg', '0.1.0')] },
    { version: '0.10.0', date: '2026-10-16T10:00:00Z', files: [file('zip', '0.10.0'), file('dmg', '0.10.0')] },
    { version: '0.2.0', date: '2026-10-15T10:00:00Z', files: [file('dmg', '0.2.0')] },
  ],
};

describe('landing render', () => {
  it('orders versions semantically, not alphabetically', () => {
    expect(compareVersions('0.10.0', '0.2.0')).toBeGreaterThan(0);
    expect(sortReleases(manifest.releases).map((r) => r.version)).toEqual(['0.10.0', '0.2.0', '0.1.0']);
  });

  it('puts the newest installer in the hero and lists every file, escaping notes', () => {
    const page = renderPage(manifest);
    expect(page.latest).toContain('Descargar Pied Piper 0.10.0');
    expect(page.latest).toContain('href="./releases/0.10.0/x.dmg"');
    expect(page.list).toContain('data-version="0.1.0"');
    expect(page.list).toContain('First &lt;build&gt;');
    expect(page.list.match(/<a /g)).toHaveLength(4);
    expect(page.empty).toBe(false);
    expect(installerOf(manifest.releases[1]).kind).toBe('dmg');
  });

  it('formats sizes in megabytes and handles an empty manifest', () => {
    expect(formatSize(217_564_710)).toBe('207 MB');
    expect(formatSize(12 * 1024 * 1024 + 300_000)).toBe('12.3 MB');
    const page = renderPage({ product: 'Pied Piper', platform: 'darwin-arm64', releases: [] });
    expect(page.empty).toBe(true);
    expect(page.latest).toContain('Todavía no hay versiones');
  });
});
