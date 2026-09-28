import { AnimatedLogo } from './AnimatedLogo';
import { AuroraBackground } from './AuroraBackground';

export const Splash = () => (
  <AuroraBackground>
    <div className="splash" data-testid="splash"><AnimatedLogo size={56} /></div>
  </AuroraBackground>
);
