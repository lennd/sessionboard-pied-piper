import { useEffect, useState } from 'react';
import { PiperMark } from '../../components/PiperMark';
import { useActivity } from '../../components/activity';
import { useI18n } from '../../i18n/I18nProvider';

const WORD_MS = 1300;
const MARK_SIZE = 120;

/** Shown over the canvas while the agent works: the piper plays, and a random word from the catalog rolls by. */
export const BusyOverlay = () => {
  const { busy, label, detail } = useActivity();
  const { t } = useI18n();
  const words = t('busy.words').split('|').map((w) => w.trim()).filter(Boolean);
  const [word, setWord] = useState<string>(() => words[0] ?? '');
  useEffect(() => {
    if (!busy || words.length === 0) return;
    const pick = () => setWord(words[Math.floor(Math.random() * words.length)] ?? '');
    pick();
    const timer = setInterval(pick, WORD_MS);
    return () => clearInterval(timer);
    // The catalog only changes with the UI language; re-picking on every render would jitter.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, words.join('|')]);
  if (!busy) return null;
  return (
    <div className="busy-overlay" data-testid="busy-overlay" role="status" aria-live="polite">
      <div className="busy-card">
        <span className="busy-mark"><PiperMark size={MARK_SIZE} color="var(--text)" /></span>
        <div className="busy-word" key={word} data-testid="busy-word">{word}</div>
        <div className="busy-label">{label}</div>
        {detail && <div className="busy-detail" data-testid="busy-detail">{detail}</div>}
      </div>
    </div>
  );
};
