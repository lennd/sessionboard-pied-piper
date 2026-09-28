import { RISK_CATEGORIES, type RiskCategory, type Scene } from '@rdi/scene/v2';
import { useState } from 'react';
import { useI18n } from '../../i18n/I18nProvider';
import { severityRank } from '../engine/risks';

type RisksPanelProps = { scene: Scene; selectedRiskId: string | null; onSelect: (riskId: string) => void };

export const RisksPanel = ({ scene, selectedRiskId, onSelect }: RisksPanelProps) => {
  const { t } = useI18n();
  const [filter, setFilter] = useState<RiskCategory | null>(null);
  if (scene.risks.length === 0) return <p className="muted" style={{ padding: '8px 10px' }}>{t('risks.empty')}</p>;
  const present = RISK_CATEGORIES.filter((c) => scene.risks.some((r) => r.category === c));
  const shown = present.filter((c) => filter === null || c === filter);

  return (
    <div>
      <div className="chips">
        {present.map((c) => (
          <button key={c} type="button" className="chip" data-testid={`risk-filter-${c}`} aria-pressed={filter === c} onClick={() => setFilter(filter === c ? null : c)}>
            {t(`category.${c}`)}
          </button>
        ))}
      </div>
      {shown.map((category) => (
        <div key={category}>
          <div className="sec-title">{t(`category.${category}`)}</div>
          {scene.risks
            .filter((r) => r.category === category)
            .sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
            .map((risk) => (
              <button key={risk.id} type="button" className={risk.id === selectedRiskId ? 'risk-item is-selected' : 'risk-item'} data-testid={`risk-${risk.id}`} onClick={() => onSelect(risk.id)}>
                <span className={`risk-dot sev-${risk.severity}`} />
                <span>
                  <span className="muted">{t(`severity.${risk.severity}`)} · </span>
                  {risk.title}
                </span>
              </button>
            ))}
        </div>
      ))}
    </div>
  );
};
