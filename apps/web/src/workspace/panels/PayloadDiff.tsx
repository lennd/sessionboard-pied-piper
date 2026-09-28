import type { Payload } from '@rdi/scene/v2';
import { diffLines } from 'diff';
import { useI18n } from '../../i18n/I18nProvider';

type Line = { text: string; kind: 'added' | 'removed' | 'same' };

const toLines = (before: string, after: string): Line[] =>
  diffLines(before, after).flatMap((part) => {
    const kind: Line['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'same';
    return part.value.replace(/\n$/, '').split('\n').map((text) => ({ text, kind }));
  });

const PREFIX: Record<Line['kind'], string> = { added: '+ ', removed: '- ', same: '  ' };

export const PayloadDiff = ({ payload }: { payload?: Payload }) => {
  const { t } = useI18n();
  if (!payload) return null;
  return (
    <aside className="payload" data-testid="payload-panel">
      <header className="payload-head">
        <span>{t('payload.title')}</span>
        <span>{payload.format.toUpperCase()}</span>
      </header>
      <pre>
        {toLines(payload.before ?? '', payload.after ?? '').map((line, i) => (
          <div key={i} className={`diff-line--${line.kind}`}>{PREFIX[line.kind]}{line.text}</div>
        ))}
      </pre>
    </aside>
  );
};
