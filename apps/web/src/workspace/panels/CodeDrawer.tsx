import type { SceneNode } from '@rdi/scene';
import { useEffect, useState } from 'react';
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

export type CodeRef = NonNullable<SceneNode['code']>;

export const CodeDrawer = ({ node, onClose, loadCode }: { node: SceneNode; onClose: () => void; loadCode?: (code: CodeRef) => Promise<string> }) => {
  const { t } = useI18n();
  const code = node.code;
  const [loaded, setLoaded] = useState<{ key: string; snippet: string | null } | null>(null);
  const key = code ? `${code.repo}|${code.path}|${code.startLine}|${code.endLine}` : '';

  useEffect(() => {
    if (!code || code.snippet || !loadCode) return;
    let cancelled = false;
    loadCode(code)
      .then((snippet) => { if (!cancelled) setLoaded({ key, snippet }); })
      .catch(() => { if (!cancelled) setLoaded({ key, snippet: null }); });
    return () => {
      cancelled = true;
    };
  }, [key, loadCode]);

  if (!code) return null;
  const snippet = code.snippet ?? (loaded?.key === key ? loaded.snippet : undefined);
  const loading = !code.snippet && Boolean(loadCode) && loaded?.key !== key;
  return (
    <aside className="drawer" data-testid="code-drawer">
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <span className="kw">⟨/⟩ {t('code.title')} · {node.label}</span>
        <button type="button" className="btn" data-testid="code-close" onClick={onClose}>{t('code.close')}</button>
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{code.repo}/{code.path}:{code.startLine}-{code.endLine}</div>
      {loading ? (
        <p className="muted" data-testid="code-loading">{t('code.loading')}</p>
      ) : snippet ? (
        <pre>{highlightCode(snippet).map((part, i) => (typeof part === 'string' ? part : <span key={i} className="kw">{part.kw}</span>))}</pre>
      ) : (
        <p className="muted">{t('code.unavailable')}</p>
      )}
    </aside>
  );
};
