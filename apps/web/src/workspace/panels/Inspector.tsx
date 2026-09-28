import type { SceneNode, SceneRisk } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import type { Frame } from '../engine/frame';
import { ComponentCard } from './ComponentCard';

type InspectorProps = {
  frame: Frame; selectedNode: SceneNode | null; risksForNode: SceneRisk[]; selectedRisk: SceneRisk | null; riskNodeLabels: string[];
  canOpenInside: boolean; onOpenInside: () => void; onViewCode: () => void; onSelectRisk: (id: string) => void;
};

export const Inspector = (p: InspectorProps) => {
  const { t } = useI18n();
  return (
    <aside className="ws-inspector">
      <div>
        <div className="h" style={{ marginTop: 0 }}>{t('now.title')}</div>
        <div className="now" data-testid="now">
          {p.frame.flat ? (
            <>
              <b>{t('now.step', { path: p.frame.flat.path })}</b>
              <br />
              {p.frame.flat.step.narration}
            </>
          ) : (
            <span className="muted">{t('now.idle')}</span>
          )}
        </div>
      </div>
      {p.selectedRisk && (
        <div className="risk-card" data-testid="risk-detail">
          <div><span className={`risk-dot sev-${p.selectedRisk.severity}`} style={{ display: 'inline-block', marginRight: 6 }} /><b>{p.selectedRisk.title}</b></div>
          <div className="muted">{t(`category.${p.selectedRisk.category}`)} · {t(`severity.${p.selectedRisk.severity}`)}</div>
          <p>{p.selectedRisk.explanation}</p>
          {p.selectedRisk.mitigation && <p><span className="muted">{t('risks.mitigation')}: </span>{p.selectedRisk.mitigation}</p>}
          <div className="muted">{t('risks.affects')}: {p.riskNodeLabels.join(', ')}</div>
        </div>
      )}
      <ComponentCard node={p.selectedNode} risks={p.risksForNode} canOpenInside={p.canOpenInside} onOpenInside={p.onOpenInside} onViewCode={p.onViewCode} onSelectRisk={p.onSelectRisk} />
    </aside>
  );
};
