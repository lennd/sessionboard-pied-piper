import { useI18n } from '../../i18n/I18nProvider';
import { UI_LANGUAGES } from '../../i18n/messages';

export const LanguagePills = () => {
  const { language, setLanguage } = useI18n();
  return (
    <div className="pills" role="group" aria-label="Language">
      {UI_LANGUAGES.map((l) => (
        <button key={l} type="button" data-testid={`lang-${l}`} aria-pressed={language === l} onClick={() => setLanguage(l)}>
          {l.toUpperCase()}
        </button>
      ))}
    </div>
  );
};
