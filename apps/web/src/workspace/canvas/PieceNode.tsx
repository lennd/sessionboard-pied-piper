import { Handle, Position, type NodeProps } from '@xyflow/react';
import { useI18n } from '../../i18n/I18nProvider';
import { brandBySlug } from './brands';
import { RepoIcon, RoleIcon } from './icons';
import type { PieceData } from './toFlow';

const HIDDEN_HANDLE = { opacity: 0, pointerEvents: 'none' as const, top: '50%', left: '50%' };
const BRAND_SIZE = 14;
const TILE_ICON = 20;

export const pieceClasses = (d: { state: string; active: boolean; selected: boolean; change?: string }, base: string) =>
  [base, `is-${d.state}`, d.active && 'is-active', d.selected && 'is-selected', d.change && `change-${d.change}`].filter(Boolean).join(' ');

/** Logos of the products a piece is built on, drawn in the card's own colour. */
export const BrandRow = ({ slugs, size = BRAND_SIZE }: { slugs: string[]; size?: number }) => {
  const brands = slugs.map(brandBySlug).filter((b): b is NonNullable<typeof b> => b !== null);
  if (brands.length === 0) return null;
  return (
    <span className="piece-brands" data-testid="piece-brands">
      {brands.map((b) => (
        <svg key={b.slug} className={`brand brand-${b.slug}`} width={size} height={size} viewBox="0 0 24 24" aria-label={b.title} role="img"><title>{b.title}</title><path d={b.path} fill="currentColor" /></svg>
      ))}
    </span>
  );
};

/** The tile on the left of a card: the first product logo when there is one, the role icon otherwise. */
const Tile = ({ d }: { d: Pick<PieceData, 'role' | 'brands'> }) => {
  const brand = d.brands[0] ? brandBySlug(d.brands[0]) : null;
  if (brand) return <span className={`piece-tile has-brand brand-${brand.slug}`}><svg width={TILE_ICON} height={TILE_ICON} viewBox="0 0 24 24" role="img" aria-label={brand.title}><title>{brand.title}</title><path d={brand.path} fill="currentColor" /></svg></span>;
  return <span className={`piece-tile role-${d.role ?? 'repo'}`}>{d.role ? <RoleIcon role={d.role} size={TILE_ICON} /> : <RepoIcon size={TILE_ICON} />}</span>;
};

export const PieceNode = ({ data }: NodeProps) => {
  const d = data as PieceData;
  const { t } = useI18n();
  const classes = [pieceClasses(d, 'piece'), d.role && `role-${d.role}`, d.scaleWorst && `scale-${d.scaleWorst}`, d.inCycle && 'in-cycle'].filter(Boolean).join(' ');
  const extraBrands = d.brands.slice(1);
  return (
    <div className={classes} data-testid={`node-${d.id}`}>
      <Handle type="target" position={Position.Left} style={HIDDEN_HANDLE} />
      <Tile d={d} />
      <div className="piece-body">
        <div className="piece-head">
          <span className="piece-label">{d.label}</span>
          {d.inCycle && <span className="piece-cycle" title={t('piece.cycle')}>↻</span>}
          {d.severity && <span className={`risk-dot sev-${d.severity}`} />}
        </div>
        <div className="piece-kind">{d.kindLabel}</div>
        {(d.hiddenChildren > 0 || d.change || d.persists > 0 || extraBrands.length > 0) && (
          <div className="piece-foot">
            {d.hiddenChildren > 0 && <span>▸ {t('piece.inside', { count: d.hiddenChildren })}</span>}
            {d.persists > 0 && <span className="piece-persists" data-testid="piece-persists">▤ {t('piece.persists', { count: d.persists })}</span>}
            {d.change && <span className="badge">{t(`change.${d.change}`)}</span>}
            <BrandRow slugs={extraBrands} />
          </div>
        )}
        {d.scaleWorst && <div className="piece-bar"><i /></div>}
      </div>
      {d.annotation && <div className="callout piece-annotation">{d.annotation}</div>}
      <Handle type="source" position={Position.Right} style={HIDDEN_HANDLE} />
    </div>
  );
};
