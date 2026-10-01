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
});
