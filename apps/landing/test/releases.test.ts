import { compareVersions, formatSize, installerOf, latestOf, sortReleases, type Release } from '../src/lib/releases';
import { fill, pickLanguage, STRINGS } from '../src/lib/strings';

const file = (kind: 'dmg' | 'zip', version: string) => ({ name: `Pied Piper-${version}-arm64.${kind}`, url: `./${version}.${kind}`, kind, arch: 'arm64', size: 217_564_710, sha256: 'abc' });
const releases: Release[] = [
  { version: '0.1.0', date: '2026-10-14T10:00:00Z', files: [file('dmg', '0.1.0')] },
  { version: '0.10.0', date: '2026-10-16T10:00:00Z', files: [file('zip', '0.10.0'), file('dmg', '0.10.0')] },
  { version: '0.2.0', date: '2026-10-15T10:00:00Z', files: [file('dmg', '0.2.0')] },
  { version: '0.11.0', date: '2026-10-17T10:00:00Z', prerelease: true, files: [file('dmg', '0.11.0')] },
];

describe('releases', () => {
  it('orders versions semantically and offers the newest stable one, with its installer', () => {
    expect(compareVersions('0.10.0', '0.2.0')).toBeGreaterThan(0);
    expect(sortReleases(releases).map((r) => r.version)).toEqual(['0.11.0', '0.10.0', '0.2.0', '0.1.0']);
    expect(latestOf(releases)?.version).toBe('0.10.0');
    expect(installerOf(releases[1]!)?.kind).toBe('dmg');
    expect(latestOf([releases[3]!])?.version).toBe('0.11.0');
    expect(latestOf([])).toBeNull();
  });

  it('formats sizes in megabytes', () => {
    expect(formatSize(217_564_710)).toBe('207 MB');
    expect(formatSize(12 * 1024 * 1024 + 300_000)).toBe('12.3 MB');
  });
});

describe('strings', () => {
  it('picks Spanish for Spanish browsers or a saved choice, English otherwise', () => {
    expect(pickLanguage(null, ['es-AR', 'en'])).toBe('es');
    expect(pickLanguage(null, ['pt-BR'])).toBe('en');
    expect(pickLanguage('es', ['en-US'])).toBe('es');
    expect(fill(STRINGS.es.download, { version: '0.2.0' })).toBe('Descargar Pied Piper 0.2.0');
  });
});
