import type { FlatStep, Step } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';

type WalkthroughTreeProps = {
  steps: Step[]; numbering: Map<string, string>; flat: FlatStep[]; cursor: number; openSteps: string[];
  onSeek: (index: number) => void; onToggle: (stepId: string) => void;
};

export const WalkthroughTree = ({ steps, numbering, flat, cursor, openSteps, onSeek, onToggle }: WalkthroughTreeProps) => {
  const { t } = useI18n();
  if (steps.length === 0) return <p className="muted" style={{ padding: '8px 10px' }}>{t('walkthrough.empty')}</p>;
  const positionOf = new Map(flat.map((f, i) => [f.step.id, i]));
  const currentId = flat[cursor]?.step.id;

  const renderSteps = (list: Step[], depth: number) =>
    list.map((step) => {
      const position = positionOf.get(step.id);
      const open = openSteps.includes(step.id);
      const classes = ['step', step.id === currentId && 'is-current', position !== undefined && position < cursor && 'is-done'].filter(Boolean).join(' ');
      return (
        <div key={step.id}>
          <div className="step-row" style={{ paddingLeft: 6 + depth * 14 }}>
            {step.substeps.length > 0 ? (
              <button type="button" className="twisty" data-testid={`step-toggle-${step.id}`} aria-expanded={open} aria-label={open ? t('explorer.collapse') : t('explorer.expand')} onClick={() => onToggle(step.id)}>
                {open ? '▾' : '▸'}
              </button>
            ) : (
              <span className="twisty" />
            )}
            <button type="button" className={classes} data-testid={`step-${step.id}`} aria-current={step.id === currentId ? 'step' : undefined} onClick={() => position !== undefined && onSeek(position)}>
              <span className="step-path">{numbering.get(step.id)}</span>
              {step.narration}
            </button>
          </div>
          {open && renderSteps(step.substeps, depth + 1)}
        </div>
      );
    });

  return <div className="steps">{renderSteps(steps, 0)}</div>;
};
