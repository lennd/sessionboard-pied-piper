import { demoRepoPath, githubCloneUrl, isDemoRepo, type CloneSource, type GitHubClient } from '@rdi/providers';
import type { IndexableRepo } from './repoStore';

export const createSourceResolver = ({ fixturesDir, github }: { fixturesDir: string; github: GitHubClient | null }) =>
  async (repo: IndexableRepo): Promise<CloneSource> => {
    if (repo.githubInstallationId !== null) {
      if (!github) throw new Error('GitHub App is not configured on the worker');
      const token = await github.installationToken(repo.githubInstallationId);
      return { kind: 'git', url: githubCloneUrl(repo.fullName, token), branch: repo.defaultBranch };
    }
    const path = isDemoRepo(repo.fullName) ? demoRepoPath(fixturesDir, repo.fullName) : null;
    if (!path) throw new Error(`${repo.fullName} is not a known demo repository`);
    return { kind: 'local', path };
  };
