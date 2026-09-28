import { sampleSceneRegistry, sampleScenes, type Scene } from '@rdi/scene';
import { useCallback, useMemo, useReducer, useState } from 'react';
import { Canvas } from './canvas/Canvas';
import { frameAt } from './engine/frame';
import { currentSceneId, enterZoom, goToDepth, rootNav, type NavState } from './engine/navigation';
import { initialPlayerState, reducePlayer, type PlayerAction, type PlayerState } from './engine/player';
import { usePlaybackClock } from './engine/usePlaybackClock';
import { NarrationPanel } from './panels/NarrationPanel';
import { PayloadPanel } from './panels/PayloadPanel';
import { PlayerControls } from './panels/PlayerControls';
import { SceneTabs } from './panels/SceneTabs';

type Playback = { sceneId: string; player: PlayerState };
type PlaybackAction = PlayerAction & { stepCount: number };

const playbackReducer = (state: Playback, action: PlaybackAction | { type: 'load'; sceneId: string }): Playback => {
  if (action.type === 'load') return { sceneId: action.sceneId, player: reducePlayer(state.player, { type: 'reset' }, 0) };
  const { stepCount, ...playerAction } = action;
  return { ...state, player: reducePlayer(state.player, playerAction as PlayerAction, stepCount) };
};

const DEFAULT_SCENE = sampleScenes[0] as Scene;

export const App = () => {
  const [nav, setNav] = useState<NavState>(rootNav(DEFAULT_SCENE.id));
  const scene = sampleSceneRegistry[currentSceneId(nav)] ?? DEFAULT_SCENE;
  const [playback, dispatchPlayback] = useReducer(playbackReducer, { sceneId: scene.id, player: initialPlayerState });

  if (playback.sceneId !== scene.id) dispatchPlayback({ type: 'load', sceneId: scene.id });
  const player = playback.sceneId === scene.id ? playback.player : initialPlayerState;

  const dispatch = useCallback(
    (action: PlayerAction) => dispatchPlayback({ ...action, stepCount: scene.steps.length }),
    [scene.steps.length],
  );
  usePlaybackClock(player.playing, (deltaMs) => dispatch({ type: 'tick', deltaMs }));

  const frame = useMemo(() => frameAt(scene, player.stepIndex), [scene, player.stepIndex]);

  return (
    <div className="app">
      <aside className="app__left">
        <NarrationPanel scene={scene} stepIndex={frame.stepIndex} onSeek={(stepIndex) => dispatch({ type: 'seek', stepIndex })} />
        <PayloadPanel payload={frame.step?.payload} />
      </aside>
      <main className="app__right">
        <SceneTabs scenes={sampleScenes} activeId={nav.stack[0] as string} onSelect={(id) => setNav(rootNav(id))} />
        <nav className="breadcrumb" data-testid="breadcrumb">
          {nav.stack.map((id, depth) => (
            <button key={id} type="button" data-testid={`crumb-${depth}`} onClick={() => setNav(goToDepth(nav, depth))}>
              {sampleSceneRegistry[id]?.title ?? id}
            </button>
          ))}
        </nav>
        <Canvas
          scene={scene}
          frame={frame}
          progress={player.progress}
          onZoom={(nodeId) => setNav(enterZoom(nav, scene, nodeId, sampleSceneRegistry))}
        />
        <PlayerControls state={player} stepCount={scene.steps.length} dispatch={dispatch} />
      </main>
    </div>
  );
};
