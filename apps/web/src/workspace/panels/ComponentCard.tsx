import type { SceneNode, SceneRisk } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import { severityRank } from '../engine/risks';

const STATUS_GLYPH = { ok: '✓', strained: '●', limit: '▲', saturated: '✕' } as const;
const ROWS = ['low', 'medium', 'high'] as const;
const STRATEGY_KEY = { horizontal: 'strategy.horizontal', vertical: 'strategy.vertical', none: 'strategy.none', external: 'strategy.external', 'n/a': 'strategy.na' } as const;

type ComponentCardProps = {
  node: SceneNode | null; risks: SceneRisk[]; canOpenInside: boolean;
  onOpenInside: () => void; onViewCode: () => void; onSelectRisk: (id: string) => void;
};

export const ComponentCard = ({ node, risks, canOpenInside, onOpenInside, onViewCode, onSelectRisk }: ComponentCardProps) => {
  const { t } = useI18n();
  if (!node) return <p className="muted" data-testid="card">{t('card.none')}</p>;
  return (
    <section data-testid="card">
      <div className="h">{t('card.title')}</div>
      <div className="card-title">{node.label}</div>
      <div className="muted">{node.role} · {node.kind}</div>
      <p style={{ margin: '6px 0' }}>{node.summary}</p>
      {node.details && <details><summary className="muted">{t('card.details')}</summary><p>{node.details}</p></details>}
      {node.complexity && (
        <div>
          <div className="h">{t('card.complexity')}</div>
          {t('card.time')} <b className="status-ok">{node.complexity.time}</b>
          {node.complexity.space && <> · {t('card.space')} <b className="status-ok">{node.complexity.space}</b></>}
          {node.complexity.note && <div className="muted">{node.complexity.note}</div>}
        </div>
      )}
      {node.scale && (
        <div>
          <div className="h">{t('card.atScale')}</div>
          {ROWS.map((row) => {
            const { status, note } = node.scale![row];
            return (
              <div key={row} className="scale-row" data-testid={`scale-row-${row}`}>
                <span className={`status-${status}`}>{STATUS_GLYPH[status]} {t(`card.${row}`)}<br /><span className="muted">{t(`status.${status}`)}</span></span>
                <span>{note}</span>
              </div>
            );
          })}
          <div className="scale-row">
            <span className="muted">{t(STRATEGY_KEY[node.scale.strategy])}</span>
            <span>{node.scale.advice}</span>
          </div>
        </div>
      )}
      {node.persists && node.persists.length > 0 && (
        <div data-testid="card-persists">
          <div className="h">{t('card.persists')}</div>
          {node.persists.map((row) => (
            <div key={row.label} className="persist-row">
              <div className="muted">{row.label}{row.format ? ` · ${row.format.toUpperCase()}` : ''}</div>
              <pre>{row.example}</pre>
            </div>
          ))}
        </div>
      )}
      <div className="h">{t('card.risks')}</div>
      {risks.length === 0 ? (
        <p className="muted">{t('card.noRisks')}</p>
      ) : (
        [...risks].sort((a, b) => severityRank(b.severity) - severityRank(a.severity)).map((risk) => (
          <button key={risk.id} type="button" className="risk-item" style={{ padding: '3px 0' }} data-testid={`card-risk-${risk.id}`} onClick={() => onSelectRisk(risk.id)}>
            <span className={`risk-dot sev-${risk.severity}`} />
            <span><span className="muted">{t(`category.${risk.category}`)} · </span>{risk.title}</span>
          </button>
        ))
      )}
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {canOpenInside && <button type="button" className="btn btn-accent" data-testid="open-inside" onClick={onOpenInside}>▸ {t('card.openInside')}</button>}
        {node.code && <button type="button" className="btn" data-testid="view-code" onClick={onViewCode}>⟨/⟩ {t('card.viewCode')}</button>}
      </div>
    </section>
  );
};
