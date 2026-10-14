import { useI18n } from '../../i18n/I18nProvider';

type CalloutProps = {
  x: number; y: number; path: string; narration: string; repeat?: string;
  canOpen: boolean; canViewCode: boolean; riskCount: number;
  onOpen: () => void; onViewCode: () => void; onRisks: () => void;
};

export const Callout = ({ x, y, path, narration, repeat, canOpen, canViewCode, riskCount, onOpen, onViewCode, onRisks }: CalloutProps) => {
  const { t } = useI18n();
  return (
    <div className="callout" data-testid="callout" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <span className="callout-path">{path}</span>
      {narration}
      {repeat && <div className="callout-repeat" data-testid="callout-repeat">↻ {t('step.repeat', { rule: repeat })}</div>}
      {(canOpen || canViewCode || riskCount > 0) && (
        <div className="callout-actions">
          {canOpen && <button type="button" className="btn" data-testid="callout-open" onClick={onOpen}>▸ {t('callout.openDetail')}</button>}
          {canViewCode && <button type="button" className="btn" data-testid="callout-code" onClick={onViewCode}>⟨/⟩ {t('callout.viewCode')}</button>}
          {riskCount > 0 && <button type="button" className="btn" data-testid="callout-risks" onClick={onRisks}>⚠ {t('callout.risks', { count: riskCount })}</button>}
        </div>
      )}
    </div>
  );
};
