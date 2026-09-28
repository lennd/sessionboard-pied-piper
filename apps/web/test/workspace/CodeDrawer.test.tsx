import { fireEvent, render, screen } from '@testing-library/react';
import type { SceneNode } from '@rdi/scene';
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

const endpointNode = { id: 'n', label: 'POST /api/orders', role: 'compute', kind: 'HTTP endpoint', summary: 's', code: { repo: 'acme/api', path: 'src/server.ts', startLine: 4, endLine: 8, language: 'typescript' } } as SceneNode;
const wrapDrawer = (ui: React.ReactElement) => render(<I18nProvider initialLanguage="en">{ui}</I18nProvider>);

describe('CodeDrawer on demand', () => {
  it('loads code on demand when the scene has no snippet', async () => {
    const loadCode = vi.fn().mockResolvedValue("app.post('/api/orders', createOrderHandler);");
    wrapDrawer(<CodeDrawer node={endpointNode} onClose={() => {}} loadCode={loadCode} />);
    expect(screen.getByTestId('code-loading')).toBeInTheDocument();
    expect(await screen.findByText(/createOrderHandler/)).toBeInTheDocument();
    expect(loadCode).toHaveBeenCalledWith(endpointNode.code);
  });

  it('shows the unavailable notice when loading fails or no loader exists', async () => {
    wrapDrawer(<CodeDrawer node={endpointNode} onClose={() => {}} loadCode={() => Promise.reject(new Error('404'))} />);
    expect(await screen.findByText('Code will be available after the repository is indexed.')).toBeInTheDocument();
  });

  it('prefers an embedded snippet', () => {
    wrapDrawer(<CodeDrawer node={{ ...endpointNode, code: { ...endpointNode.code!, snippet: 'const a = 1;' } }} onClose={() => {}} loadCode={vi.fn()} />);
    expect(screen.getByText(/a = 1/)).toBeInTheDocument();
  });
});
