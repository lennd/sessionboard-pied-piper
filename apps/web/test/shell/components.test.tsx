import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { messages } from '../../src/i18n/messages';
import { AnimatedLogo } from '../../src/shell/components/AnimatedLogo';
import { AuroraBackground } from '../../src/shell/components/AuroraBackground';
import { Segmented } from '../../src/shell/components/Segmented';

const wrap = (ui: React.ReactElement) => render(<I18nProvider initialLanguage="en"><MemoryRouter>{ui}</MemoryRouter></I18nProvider>);

describe('Aurora components', () => {
  it('renders the animated logo with the product name', () => {
    wrap(<AnimatedLogo />);
    expect(screen.getByTestId('animated-logo')).toHaveTextContent('pied piper');
    expect(screen.getByTestId('animated-logo').querySelectorAll('circle.note')).toHaveLength(3);
  });

  it('renders the background layers and children', () => {
    wrap(<AuroraBackground><p>inside</p></AuroraBackground>);
    expect(document.querySelectorAll('.aurora-blob')).toHaveLength(3);
    expect(screen.getByText('inside')).toBeInTheDocument();
  });

  it('segmented control reports changes', () => {
    const onChange = vi.fn();
    wrap(<Segmented testid="seg" value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('seg-b'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('seg-a')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has every shell key translated in es and pt', () => {
    const shellKeys = Object.keys(messages.en).filter((k) => /^(nav|repos|prefs|errors|sessions|pulls|rules|toolkit|run|handoff|solutions|chat)\./.test(k));
    expect(shellKeys.length).toBeGreaterThan(80);
    shellKeys.forEach((k) => {
      expect(messages.es, k).toHaveProperty(k);
      expect(messages.pt, k).toHaveProperty(k);
    });
  });
});
