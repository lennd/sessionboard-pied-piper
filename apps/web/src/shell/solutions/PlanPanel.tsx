import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import type { SolutionDetail } from './solutionsApi';

const STATUS_GLYPH = { todo: '○', in_progress: '◐', done: '✓', blocked: '✕' } as const;

export type PlanRepo = { id: string; name: string; available: boolean; run?: 'running' | 'done' | 'error' | 'cancelled' | null };
type Props = { detail: SolutionDetail; ctx: ChatContext; onVersion: (n: number) => void; onExecute: () => void; repos?: PlanRepo[]; onExecuteRepo?: (repoId: string) => void };

/** Tasks of one solution; when `repos` is given (a feature plan) the tasks are grouped per repository with their own run button. */
export const PlanPanel = ({ detail, ctx, onVersion, onExecute, repos, onExecuteRepo }: Props) => {
  const { t } = useI18n();
  const { draft } = detail.version;
  const taskLabel = new Map(draft.plan.map((task) => [task.id, task.repo ? `${task.repo}/${task.title}` : task.title]));
  const groups: { key: string; repo: PlanRepo | null; tasks: typeof draft.plan }[] = repos
    ? [
        ...repos.map((repo) => ({ key: repo.id, repo, tasks: draft.plan.filter((task) => task.repo === repo.name) })),
        { key: 'other', repo: null, tasks: draft.plan.filter((task) => !task.repo || !repos.some((r) => r.name === task.repo)) },
      ].filter((g) => g.tasks.length > 0 || g.repo)
    : [{ key: 'all', repo: null, tasks: draft.plan }];
  const progress = (tasks: typeof draft.plan) => ({ done: tasks.filter((task) => detail.tasks[task.id]?.status === 'done').length, total: tasks.length });
  const focusTask = (nodeRefs: string[]) => {
    const target = nodeRefs[0];
    if (!target) return;
    if (!ctx.scene.nodes.some((n) => n.id === target) && draft.sceneProposed) ctx.openScene({ ...draft.sceneProposed, id: `${detail.id}-v${detail.version.n}-proposed` });
    ctx.selectNode(target);
  };
  return (
    <div className="plan" data-testid="plan-panel">
      <div className="plan-head">
        <b>◆ {detail.title}</b>
        <span className={`tag status-${detail.status}`}>{t(`solutionStatus.${detail.status}`)}</span>
      </div>
      <label className="plan-version">
        {t('plan.version')}
        <select data-testid="plan-version" value={detail.version.n} onChange={(e) => onVersion(Number(e.target.value))}>
          {detail.versions.map((v) => <option key={v.n} value={v.n}>v{v.n} · {v.summary.slice(0, 40)}</option>)}
        </select>
      </label>
      <p className="muted" data-testid="plan-author">{t(`plan.by.${detail.version.author}`)} · {t('plan.updated')}</p>
      <p>{draft.summary}</p>
      {groups.map((group) => (
        <div key={group.key} data-testid={group.repo ? `plan-repo-${group.repo.id}` : 'plan-tasks-all'}>
          <div className="sec-title plan-repo-head">
            <span>{group.repo ? `▣ ${group.repo.name}` : repos ? t('plan.otherTasks') : t('plan.title')}</span>
            {group.repo && (
              <span className="plan-repo-meta">
                <span className="muted">{t('plan.progress', progress(group.tasks))}</span>
                {group.repo.run && <span className={`tag status-${group.repo.run === 'done' ? 'done' : group.repo.run === 'running' ? 'in_progress' : 'draft'}`} data-testid={`plan-repo-run-${group.repo.id}`}>{t(`run.status.${group.repo.run}`)}</span>}
                {onExecuteRepo && group.repo.available && group.tasks.length > 0 && (
                  <button type="button" className="btn-primary btn-small" data-testid={`plan-execute-${group.repo.id}`} disabled={group.repo.run === 'running'} onClick={() => onExecuteRepo(group.repo!.id)}>▶ {t('plan.executeRepo')}</button>
                )}
                {!group.repo.available && <span className="tag status-draft">{t('plan.repoMissing')}</span>}
              </span>
            )}
          </div>
          <ol className="plan-tasks">
            {group.tasks.map((task) => {
              const state = detail.tasks[task.id];
              const status = state?.status ?? 'todo';
              return (
                <li key={task.id}>
                  <button type="button" className={`plan-task is-${status}`} data-testid={`plan-task-${task.id}`} onClick={() => focusTask(task.nodeRefs)}>
                    <span data-testid={`plan-task-status-${task.id}`} className="plan-status">{STATUS_GLYPH[status]} {t(`taskStatus.${status}`)}</span>
                    <b>{task.title}</b>
                    {task.dependsOn.length > 0 && <span className="muted">{t('plan.dependsOn', { tasks: task.dependsOn.map((id) => taskLabel.get(id) ?? id).join(', ') })}</span>}
                    {task.acceptance.length > 0 && <span className="muted">{t('plan.acceptance')}: {task.acceptance.join(' · ')}</span>}
                    {state?.note && <span className="plan-note">{state.note}</span>}
                  </button>
                </li>
              );
            })}
          </ol>
        </div>
      ))}
      {draft.risks.length > 0 && (
        <div data-testid="plan-risks">
          <div className="sec-title">{t('plan.risks')}</div>
          {draft.risks.map((risk, i) => (
            <div key={i} className="risk-item"><span className={`risk-dot sev-${risk.severity}`} /> {risk.title}{risk.mitigation ? ` — ${risk.mitigation}` : ''}</div>
          ))}
        </div>
      )}
      {!repos && <button type="button" className="btn-primary btn-small plan-execute" data-testid="plan-execute" onClick={onExecute}>▶ {t('plan.execute')}</button>}
    </div>
  );
};
