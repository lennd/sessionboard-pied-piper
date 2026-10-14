import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { messages } from '../../src/i18n/messages';
import { AnimatedLogo } from '../../src/shell/components/AnimatedLogo';
import { AuroraBackground } from '../../src/shell/components/AuroraBackground';
import { Field } from '../../src/shell/components/Field';
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

  it('labels fields and exposes errors accessibly', () => {
    wrap(<Field label="Email" error="Required" value="" onChange={() => {}} />);
    const input = screen.getByLabelText('Email');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByRole('alert')).toHaveTextContent('Required');
  });

  it('segmented control reports changes', () => {
    const onChange = vi.fn();
    wrap(<Segmented testid="seg" value="a" options={[{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }]} onChange={onChange} />);
    fireEvent.click(screen.getByTestId('seg-b'));
    expect(onChange).toHaveBeenCalledWith('b');
    expect(screen.getByTestId('seg-a')).toHaveAttribute('aria-pressed', 'true');
  });

  it('has every shell key translated in es and pt', () => {
    const shellKeys = Object.keys(messages.en).filter((k) => /^(shell|auth|invite|onboarding|nav|general|members|repos|stage|repoStatus|usage|prefs|security|errors|common|role)\./.test(k));
    expect(shellKeys.length).toBeGreaterThan(100);
    shellKeys.forEach((k) => {
      expect(messages.es, k).toHaveProperty(k);
      expect(messages.pt, k).toHaveProperty(k);
    });
  });
});
