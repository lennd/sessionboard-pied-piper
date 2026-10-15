import { checksumsFor, fromGithubReleases, parseChecksums } from '../../../scripts/release/manifest.mjs';

const asset = (name, size = 100) => ({ name: name.replace(/ /g, '.'), size, browser_download_url: `https://github.com/acme/pied-piper/releases/download/v0.2.0/${encodeURIComponent(name.replace(/ /g, '.'))}` });
const releases = [
  { tag_name: 'v0.2.0', draft: false, prerelease: false, published_at: '2026-10-15T10:00:00Z', body: 'Canvas nuevo.\n', assets: [asset('Pied Piper-0.2.0-arm64.dmg', 217564710), asset('Pied Piper-0.2.0-arm64.zip'), asset('checksums.txt', 10)] },
  { tag_name: 'v0.3.0', draft: true, assets: [asset('Pied Piper-0.3.0-arm64.dmg')] },
  { tag_name: 'nightly', draft: false, assets: [asset('x.dmg')] },
  { tag_name: 'v0.1.0', draft: false, prerelease: true, published_at: '2026-10-14T10:00:00Z', body: '', assets: [] },
];

describe('manifest from GitHub Releases', () => {
  it('keeps published version tags with installers, drops drafts, odd tags and empty releases', () => {
    const list = fromGithubReleases(releases, new Map([['v0.2.0', parseChecksums('abc123  Pied Piper-0.2.0-arm64.dmg\n')]]));
    expect(list).toHaveLength(1);
    const [release] = list;
    expect(release.version).toBe('0.2.0');
    expect(release.notes).toBe('Canvas nuevo.');
    expect(release.files.map((f) => [f.kind, f.size, f.sha256])).toEqual([['dmg', 217564710, 'abc123'], ['zip', 100, '']]);
    expect(release.files[0].url).toContain('/releases/download/v0.2.0/Pied.Piper-0.2.0-arm64.dmg');
  });

  it('reads the checksums asset of every release that has one', async () => {
    const seen = [];
    const sums = await checksumsFor(releases, async (url) => { seen.push(url); return 'ffff *Pied Piper-0.2.0-arm64.zip'; });
    expect(seen).toHaveLength(1);
    expect(sums.get('v0.2.0').get('Pied.Piper-0.2.0-arm64.zip')).toBe('ffff');
  });
});
