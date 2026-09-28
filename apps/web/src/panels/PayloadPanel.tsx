import type { SceneStep } from '@rdi/scene';
import { diffLines } from 'diff';

type PayloadPanelProps = { payload?: SceneStep['payload'] };

type Line = { text: string; kind: 'added' | 'removed' | 'same' };

const toLines = (before: string, after: string): Line[] =>
  diffLines(before, after).flatMap((part) => {
    const kind: Line['kind'] = part.added ? 'added' : part.removed ? 'removed' : 'same';
    return part.value.replace(/\n$/, '').split('\n').map((text) => ({ text, kind }));
  });

export const PayloadPanel = ({ payload }: PayloadPanelProps) => {
  if (!payload) return null;
  const lines = toLines(payload.before ?? '', payload.after ?? '');
  return (
    <aside className="payload" data-testid="payload-panel">
      <header className="payload__header">
        Example data <span className="payload__format">{payload.format}</span>
      </header>
      <pre className="payload__body">
        {lines.map((line, i) => (
          <div key={i} className={`diff-line diff-line--${line.kind}`}>
            {line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  '}
            {line.text}
          </div>
        ))}
      </pre>
    </aside>
  );
};
