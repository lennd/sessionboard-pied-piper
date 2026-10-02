import { act, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Workspace, type ChatContext } from '../../src/workspace/Workspace';

describe('Workspace panels', () => {
  it('shows extra panels in the activity bar, opens the initial one and lets them select pieces', () => {
    let captured: ChatContext | null = null;
    render(
      <I18nProvider initialLanguage="en">
        <Workspace
          initialPanel="plan"
          panels={[{ id: 'plan', glyph: '☰', title: 'Plan', render: (ctx) => { captured = ctx; return <div data-testid="plan-slot">plan</div>; } }]}
          chat={() => <div data-testid="chat-slot">chat</div>}
        />
      </I18nProvider>,
    );
    expect(screen.getByTestId('plan-slot')).toBeVisible();
    expect(screen.getByTestId('chat-slot')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(screen.getByTestId('chat-slot')).toBeVisible();
    expect(screen.getByTestId('plan-slot')).not.toBeVisible();
    const firstNode = captured!.scene.nodes[0]!;
    act(() => captured!.selectNode(firstNode.id));
    expect(screen.getByTestId('card')).toHaveTextContent(firstNode.label);
  });

  it('opens the chat with a pending question when a panel asks the agent', () => {
    let captured: ChatContext | null = null;
    render(
      <I18nProvider initialLanguage="en">
        <Workspace
          initialPanel="pulls"
          panels={[{ id: 'pulls', glyph: '⇄', title: 'Pull requests', render: (ctx) => { captured = ctx; return <div data-testid="pulls-slot">pulls</div>; } }]}
          chat={(ctx) => <div data-testid="chat-slot">{ctx.pendingQuestion?.text ?? 'none'}</div>}
        />
      </I18nProvider>,
    );
    act(() => captured!.ask!('Review pull request a/b#1', 'analyze'));
    const first = captured!.pendingQuestion!.id;
    act(() => captured!.ask!('Review pull request a/b#1', 'analyze'));
    expect(captured!.pendingQuestion!.id).toBe(first);
    expect(screen.getByTestId('chat-slot')).toBeVisible();
    expect(screen.getByTestId('chat-slot')).toHaveTextContent('Review pull request a/b#1');
  });

  it('opens scenes in the requested mode', () => {
    let captured: ChatContext | null = null;
    render(<I18nProvider initialLanguage="en"><Workspace panels={[{ id: 'p', glyph: 'P', title: 'P', render: (ctx) => { captured = ctx; return null; } }]} /></I18nProvider>);
    const base = captured!.scene;
    act(() => captured!.openScene({ ...base, id: 'changed', title: 'Changed', nodes: base.nodes.map((n, i) => (i === 0 ? { ...n, change: 'modified' as const } : n)) }, 'changes'));
    expect(screen.getByTestId('mode-changes')).toHaveAttribute('aria-selected', 'true');
  });
});

