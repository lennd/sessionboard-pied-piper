import { PiperMark } from '../../components/PiperMark';
import { useI18n } from '../../i18n/I18nProvider';

export { PiperMark };

export const AnimatedLogo = ({ size = 36, showName = true }: { size?: number; showName?: boolean }) => {
  const { t } = useI18n();
  return (
    <span className="aurora-logo" data-testid="animated-logo">
      <PiperMark size={size} />
      {showName && <span className="wordmark">{t('app.name').toLowerCase()}</span>}
    </span>
  );
};
