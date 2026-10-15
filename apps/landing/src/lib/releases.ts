export type ReleaseFile = { name: string; url: string; kind: 'dmg' | 'zip'; arch: string; size: number; sha256: string };
export type Release = { version: string; date: string; notes?: string; prerelease?: boolean; files: ReleaseFile[] };
export type Manifest = { product: string; platform: string; releases: Release[]; generatedAt?: string };

const MB = 1024 * 1024;

export const formatSize = (bytes: number): string => `${(bytes / MB).toFixed(bytes >= 100 * MB ? 0 : 1)} MB`;

export const formatDate = (iso: string, locale = 'en-US'): string => new Date(iso).toLocaleDateString(locale, { year: 'numeric', month: 'long', day: 'numeric' });

export const compareVersions = (a: string, b: string): number => {
  const pa = a.replace(/^v/, '').split('.').map(Number);
  const pb = b.replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
};

/** Newest first, by semantic version then date. */
export const sortReleases = (releases: Release[]): Release[] => [...releases].sort((a, b) => compareVersions(b.version, a.version) || b.date.localeCompare(a.date));

/** The installer of a release, falling back to its first file. */
export const installerOf = (release: Release): ReleaseFile | null => release.files.find((f) => f.kind === 'dmg') ?? release.files[0] ?? null;

/** What the hero offers: the newest stable release, or the newest pre-release when there is nothing else. */
export const latestOf = (releases: Release[]): Release | null => {
  const sorted = sortReleases(releases);
  return sorted.find((r) => !r.prerelease) ?? sorted[0] ?? null;
};
