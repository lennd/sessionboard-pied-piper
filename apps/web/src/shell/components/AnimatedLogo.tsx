import { useI18n } from '../../i18n/I18nProvider';

/** The piper: a white silhouette with a feathered hat, a flute and a cape; the feather sways and three notes drift from the flute. */
export const PiperMark = ({ size = 36 }: { size?: number }) => (
  <svg className="piper-mark" width={size} height={size} viewBox="0 0 40 40" aria-hidden>
    <g fill="#fff">
      <path className="ft" d="M21.4 10.6 C25.2 6.4 30.2 3.9 36.6 3.4 C32.4 6 28.9 9.3 26.2 14 C25 12.6 23.3 11.4 21.4 10.6 Z" />
      <path d="M12.6 14.4 C14.4 10 20.4 8.6 24 12.4 L22.6 13.3 C19.6 10.6 15.6 11.5 14 15 Z" />
      <circle cx="18.2" cy="15.6" r="4.1" />
      <path d="M2.6 21.6 L14.6 16.9 L15.5 18.9 L3.5 23.6 Z" />
      <circle cx="11.6" cy="19.1" r="2" />
      <path d="M16.6 19.6 L21.2 19.4 C25.4 21.3 27.4 26.4 27 36.6 L13.4 36.6 C13 30.2 13.9 24.6 16.6 19.6 Z" />
      <path className="cape" d="M22.8 20.6 C28.4 22.6 33.8 27.6 37 36 C34.4 36.7 31.6 36.7 28.9 36.5 C29.8 30.2 27.8 25.2 22.8 20.6 Z" opacity=".88" />
    </g>
    <g className="notes" fill="#fff">
      <circle className="note n1" cx="3" cy="21.5" r="1.5" />
      <circle className="note n2" cx="3" cy="21.5" r="1.2" />
      <circle className="note n3" cx="3" cy="21.5" r="1" />
    </g>
  </svg>
);

export const AnimatedLogo = ({ size = 36, showName = true }: { size?: number; showName?: boolean }) => {
  const { t } = useI18n();
  return (
    <span className="aurora-logo" data-testid="animated-logo">
      <PiperMark size={size} />
      {showName && <span className="wordmark">{t('app.name').toLowerCase()}</span>}
    </span>
  );
};
