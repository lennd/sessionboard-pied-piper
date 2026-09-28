import { fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { CodeDrawer, highlightCode } from '../../src/workspace/panels/CodeDrawer';
import { fixtureScene } from './fixture';

const api = fixtureScene().nodes.find((n) => n.id === 'api')!;

describe('CodeDrawer', () => {
  it('shows location and snippet and closes', () => {
    const onClose = vi.fn();
    render(<I18nProvider initialLanguage="en"><CodeDrawer node={api} onClose={onClose} /></I18nProvider>);
    expect(screen.getByTestId('code-drawer')).toHaveTextContent('svc/src/api.ts:1-3');
    expect(screen.getByTestId('code-drawer')).toHaveTextContent('return 1;');
    fireEvent.click(screen.getByTestId('code-close'));
    expect(onClose).toHaveBeenCalled();
  });

  it('explains when there is no snippet yet', () => {
    render(<I18nProvider initialLanguage="en"><CodeDrawer node={{ ...api, code: { ...api.code!, snippet: undefined } }} onClose={vi.fn()} /></I18nProvider>);
    expect(screen.getByText('Code will be available after the repository is indexed.')).toBeInTheDocument();
  });

  it('highlights keywords', () => {
    expect(highlightCode('const x = await y')).toEqual([{ kw: 'const' }, ' x = ', { kw: 'await' }, ' y']);
  });
});
