import { useI18n } from '../../i18n/I18nProvider';

export const AnimatedLogo = ({ size = 36, showName = true }: { size?: number; showName?: boolean }) => {
  const { t } = useI18n();
  return (
    <span className="aurora-logo" data-testid="animated-logo">
      <svg width={size} height={(size * 30) / 36} viewBox="0 0 36 30" aria-hidden>
        <defs>
          <linearGradient id="aurora-logo-gradient" x1="0" x2="1">
            <stop offset="0" stopColor="#2dffa6" />
            <stop offset="1" stopColor="#18c3ff" />
          </linearGradient>
        </defs>
        <path className="lk" d="M6 22 L18 8" stroke="url(#aurora-logo-gradient)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <path className="lk b" d="M18 8 L30 22" stroke="url(#aurora-logo-gradient)" strokeWidth="2.5" fill="none" strokeLinecap="round" />
        <circle className="nd" cx="6" cy="22" r="4.5" fill="#2dffa6" />
        <circle className="nd b" cx="18" cy="8" r="4.5" fill="#18c3ff" />
        <circle className="nd c" cx="30" cy="22" r="4.5" fill="#8b7dff" />
        <circle className="tk" r="2.4" fill="#fff" />
      </svg>
      {showName && <span>{t('app.name')}</span>}
    </span>
  );
};
