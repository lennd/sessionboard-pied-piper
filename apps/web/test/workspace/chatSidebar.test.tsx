import { act, fireEvent, render, screen } from '@testing-library/react';
import { sampleRegistry, type Scene } from '@rdi/scene';
import { I18nProvider } from '../../src/i18n/I18nProvider';
import { Workspace, type ChatContext } from '../../src/workspace/Workspace';

const fresh: Scene = { ...sampleRegistry['iot-telemetry']!, id: 'agent-scene', title: 'Agent scene' };

describe('Workspace chat sidebar', () => {
  it('switches the sidebar to the chat and loads scenes the chat opens', () => {
    let captured: ChatContext | null = null;
    render(
      <I18nProvider initialLanguage="en">
        <Workspace chat={(ctx) => { captured = ctx; return <div data-testid="chat-slot">chat</div>; }} />
      </I18nProvider>,
    );
    expect(screen.queryByTestId('chat-slot')).toBeNull();
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(screen.getByTestId('chat-slot')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('activity-walkthrough'));
    expect(screen.queryByTestId('chat-slot')).toBeNull();
    fireEvent.click(screen.getByTestId('activity-chat'));
    act(() => captured!.openScene(fresh));
    expect(screen.getByTestId('scene-select')).toHaveValue('agent-scene');
    expect(screen.getByRole('option', { name: 'Agent scene (en)' })).toBeInTheDocument();
  });
});
