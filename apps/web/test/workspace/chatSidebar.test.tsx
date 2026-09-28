import { useEffect } from 'react';
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
    expect(screen.getByTestId('chat-slot')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(screen.getByTestId('chat-slot')).toBeVisible();
    fireEvent.click(screen.getByTestId('activity-walkthrough'));
    expect(screen.getByTestId('chat-slot')).not.toBeVisible();
    fireEvent.click(screen.getByTestId('activity-chat'));
    act(() => captured!.openScene(fresh));
    expect(screen.getByTestId('scene-select')).toHaveValue('agent-scene');
    expect(screen.getByRole('option', { name: 'Agent scene (en)' })).toBeInTheDocument();
  });

  it('keeps the chat mounted while the explorer is shown so answers are not aborted', () => {
    const unmounted = vi.fn();
    const Probe = () => {
      useEffect(() => unmounted, []);
      return <div data-testid="probe">chat</div>;
    };
    render(<I18nProvider initialLanguage="en"><Workspace chat={() => <Probe />} /></I18nProvider>);
    fireEvent.click(screen.getByTestId('activity-chat'));
    fireEvent.click(screen.getByTestId('activity-walkthrough'));
    fireEvent.click(screen.getByTestId('activity-chat'));
    expect(unmounted).not.toHaveBeenCalled();
  });
});

