import type { FeatureFile } from '../store/features';
import type { Root } from '../http/scope';
import { readRules, ruleLines } from '../store/rules';
import { readToolkit } from '../store/toolkit';
import { join } from 'node:path';

const RDI_DIR = '.rdi';

/** Everything the agent needs to plan across repositories: the repos it may read, the brief, and each repo's rules and harness. */
export const featureContext = async (feature: FeatureFile, roots: Root[]): Promise<string> => {
  const perRepo = await Promise.all(
    roots.map(async (root) => {
      const dir = join(root.path, RDI_DIR);
      const rules = ruleLines(await readRules(dir));
      const toolkit = (await readToolkit(dir)).trim();
      return [
        `### ${root.name} — ${root.path}`,
        ...(rules.length ? ['Rules the team checks here:', ...rules.map((r) => `- ${r}`)] : []),
        ...(toolkit ? ['Harness and commands:', toolkit] : []),
      ].join('\n');
    }),
  );
  return [
    `You are planning the feature "${feature.title}" across ${roots.length} repositor${roots.length === 1 ? 'y' : 'ies'}. Each one is a separate git repository with its own root; refer to a repository by its name and give every piece a repo (and code.repo) equal to that name, with paths relative to that repository's root.`,
    `Repositories:\n${roots.map((r) => `- ${r.name} → ${r.path}`).join('\n')}`,
    feature.brief.trim() ? `Brief (the source of truth, written by the team):\n${feature.brief.trim()}` : 'The brief is still empty; ask what the feature should do before planning.',
    ...perRepo,
    'When you save the plan with upsert_solution, give every task a repo (the repository where the work happens) and use dependsOn across repositories when one task needs another one first (for example the API contract before the UI that consumes it). Call out risks on the contracts between repositories and on each repository\'s rules; a rule break is a risk titled "Rule: …".',
  ].join('\n\n');
};
