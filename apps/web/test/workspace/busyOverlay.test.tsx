import { act, render, screen } from '@testing-library/react';
import { beginActivity, resetActivity, setActivityDetail } from '../../src/components/activity';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { BusyOverlay } from '../../src/workspace/panels/BusyOverlay';

afterEach(() => resetActivity());

describe('BusyOverlay', () => {
  it('stays hidden while idle and shows the piper, a word and the detail while the agent works', () => {
    render(<I18nProvider initialLanguage="en"><BusyOverlay /></I18nProvider>);
    expect(screen.queryByTestId('busy-overlay')).not.toBeInTheDocument();
    let end: () => void = () => {};
    act(() => { end = beginActivity('Claude is answering'); });
    expect(screen.getByTestId('busy-overlay')).toHaveTextContent('Claude is answering');
    expect(screen.getByTestId('busy-overlay').querySelector('.piper-mark')).not.toBeNull();
    expect(screen.getByTestId('busy-word').textContent?.length).toBeGreaterThan(0);
    act(() => setActivityDetail('Read src/app.ts'));
    expect(screen.getByTestId('busy-detail')).toHaveTextContent('Read src/app.ts');
    let endInner: () => void = () => {};
    act(() => { endInner = beginActivity('Claude is drawing the map'); });
    act(() => end());
    expect(screen.getByTestId('busy-overlay')).toBeInTheDocument();
    act(() => endInner());
    expect(screen.queryByTestId('busy-overlay')).not.toBeInTheDocument();
  });
});
