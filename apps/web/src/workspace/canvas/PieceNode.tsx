import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useI18n } from '../../i18n/I18nProvider';
import type { PieceData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };

export const pieceClasses = (d: { state: string; active: boolean; selected: boolean; change?: string }, base: string) =>
  [base, `is-${d.state}`, d.active && 'is-active', d.selected && 'is-selected', d.change && `change-${d.change}`].filter(Boolean).join(' ');

export const PieceNode = ({ data }: NodeProps) => {
  const d = data as PieceData;
  const { t } = useI18n();
  const classes = [pieceClasses(d, 'piece'), d.scaleWorst && `scale-${d.scaleWorst}`].filter(Boolean).join(' ');
  return (
    <div className={classes} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <div className="piece-head">
        <span aria-hidden>{d.glyph}</span>
        <span className="piece-label">{d.label}</span>
        {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
      </div>
      <div className="piece-kind">{d.kindLabel}</div>
      {(d.hiddenChildren > 0 || d.change) && (
        <div className="piece-foot">
          {d.hiddenChildren > 0 && <span>▸ {t('piece.inside', { count: d.hiddenChildren })}</span>}
          {d.change && <span className="badge">{t(`change.${d.change}`)}</span>}
        </div>
      )}
      {d.scaleWorst && <div className="piece-bar"><i /></div>}
      {d.annotation && <div className="callout" style={{ position: 'absolute', top: -34, left: 0, width: 'auto', padding: '2px 8px' }}>{d.annotation}</div>}
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
