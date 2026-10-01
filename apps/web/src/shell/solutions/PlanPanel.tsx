import { useI18n } from '../../i18n/I18nProvider';
import type { ChatContext } from '../../workspace/Workspace';
import type { SolutionDetail } from './solutionsApi';

const STATUS_GLYPH = { todo: '○', in_progress: '◐', done: '✓', blocked: '✕' } as const;

export const PlanPanel = ({ detail, ctx, onVersion, onExecute }: { detail: SolutionDetail; ctx: ChatContext; onVersion: (n: number) => void; onExecute: () => void }) => {
  const { t } = useI18n();
  const { draft } = detail.version;
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
      <div className="sec-title">{t('plan.title')}</div>
      <ol className="plan-tasks">
        {draft.plan.map((task) => {
          const state = detail.tasks[task.id];
          const status = state?.status ?? 'todo';
          return (
            <li key={task.id}>
              <button type="button" className={`plan-task is-${status}`} data-testid={`plan-task-${task.id}`} onClick={() => focusTask(task.nodeRefs)}>
                <span data-testid={`plan-task-status-${task.id}`} className="plan-status">{STATUS_GLYPH[status]} {t(`taskStatus.${status}`)}</span>
                <b>{task.title}</b>
                {task.dependsOn.length > 0 && <span className="muted">{t('plan.dependsOn', { tasks: task.dependsOn.join(', ') })}</span>}
                {task.acceptance.length > 0 && <span className="muted">{t('plan.acceptance')}: {task.acceptance.join(' · ')}</span>}
                {state?.note && <span className="plan-note">{state.note}</span>}
              </button>
            </li>
          );
        })}
      </ol>
      {draft.risks.length > 0 && (
        <div data-testid="plan-risks">
          <div className="sec-title">{t('plan.risks')}</div>
          {draft.risks.map((risk, i) => (
            <div key={i} className="risk-item"><span className={`risk-dot sev-${risk.severity}`} /> {risk.title}{risk.mitigation ? ` — ${risk.mitigation}` : ''}</div>
          ))}
        </div>
      )}
      <button type="button" className="btn-primary btn-small plan-execute" data-testid="plan-execute" onClick={onExecute}>▶ {t('plan.execute')}</button>
    </div>
  );
};
