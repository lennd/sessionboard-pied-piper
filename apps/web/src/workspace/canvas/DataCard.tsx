import type { Payload, Persisted } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';

const MAX_LINES = 8;
const clip = (text: string) => text.split('\n').slice(0, MAX_LINES).join('\n');

/** What a piece keeps, shown next to it while the walkthrough writes there: the step's data after the write, or the piece's own example record. */
export const DataCard = ({ x, y, label, payload, persisted }: { x: number; y: number; label: string; payload?: Payload; persisted?: Persisted }) => {
  const { t } = useI18n();
  const text = payload?.after ?? persisted?.example ?? null;
  if (!text) return null;
  return (
    <div className="data-card" data-testid="data-card" style={{ transform: `translate(${x}px, ${y}px)` }}>
      <div className="data-card-head">
        <span>▤ {t('canvas.dataKept', { label })}</span>
        <span className="muted">{persisted?.label ?? payload?.format.toUpperCase()}</span>
      </div>
      <pre>{clip(text)}</pre>
    </div>
  );
};
