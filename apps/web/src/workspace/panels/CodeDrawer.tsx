import type { SceneNode } from '@rdi/scene/v2';
import { useI18n } from '../../i18n/I18nProvider';

const KEYWORDS = /\b(async|await|const|let|var|function|return|if|else|for|while|of|in|new|throw|try|catch|class|export|import|from|def|self|None|True|False|SELECT|UPDATE|INSERT|WHERE|FROM|SET|FOR)\b/g;

export const highlightCode = (snippet: string): (string | { kw: string })[] => {
  const parts: (string | { kw: string })[] = [];
  let last = 0;
  for (const match of snippet.matchAll(KEYWORDS)) {
    const at = match.index ?? 0;
    if (at > last) parts.push(snippet.slice(last, at));
    parts.push({ kw: match[0] });
    last = at + match[0].length;
  }
  if (last < snippet.length) parts.push(snippet.slice(last));
  return parts;
};

export const CodeDrawer = ({ node, onClose }: { node: SceneNode; onClose: () => void }) => {
  const { t } = useI18n();
  const code = node.code;
  if (!code) return null;
  return (
    <aside className="drawer" data-testid="code-drawer">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="kw">⟨/⟩ {t('code.title')} · {node.label}</span>
        <button type="button" className="btn" data-testid="code-close" onClick={onClose}>{t('code.close')}</button>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{code.repo}/{code.path}:{code.startLine}-{code.endLine}</div>
      {code.snippet ? (
        <pre>{highlightCode(code.snippet).map((part, i) => (typeof part === 'string' ? part : <span key={i} className="kw">{part.kw}</span>))}</pre>
      ) : (
        <p className="muted">{t('code.unavailable')}</p>
      )}
    </aside>
  );
};
