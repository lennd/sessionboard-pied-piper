import {
  computeVisible, flattenSteps, indexScene, numberSteps, projectEdges, sampleRegistry, sampleScenes, type Level, type Scene,
} from '@rdi/scene';
import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { initialPlayerState, reducePlayer, type PlayerAction } from '../engine/player';
import { usePlaybackClock } from '../engine/usePlaybackClock';
import { useI18n } from '../i18n/I18nProvider';
import { applyTheme, resolveTheme, THEME_STORAGE_KEY, type ThemeId } from '../theme/themes';
import { Canvas } from './canvas/Canvas';
import { initialExplorerState, reduceExplorer, type ExplorerAction } from './engine/explorerState';
import { frameAt } from './engine/frame';
import { stepPhase } from './engine/phase';
import { resequenceCursor } from './engine/resequence';
import { risksByNode } from './engine/risks';
import { CodeDrawer } from './panels/CodeDrawer';
import { ExplorerPanel } from './panels/ExplorerPanel';
import { Footer } from './panels/Footer';
import { Inspector } from './panels/Inspector';
import { availableModes, TopBar } from './panels/TopBar';
import './workspace.css';

const DEFAULT_LEVEL: Level = 'architecture';
const sceneFor = (language: string): Scene => sampleRegistry[`checkout-${language}`] ?? sampleRegistry['checkout-en'] ?? (sampleScenes[0] as Scene);

export const Workspace = () => {
  const { language } = useI18n();
  const [explorer, dispatchRaw] = useReducer(
    (state: ReturnType<typeof initialExplorerState>, action: ExplorerAction) => reduceExplorer(state, action, sampleRegistry[state.sceneId] ?? sceneFor(language)),
    undefined,
    () => initialExplorerState(sceneFor(language).id, DEFAULT_LEVEL),
  );
  const scene = sampleRegistry[explorer.sceneId] ?? sceneFor(language);
  const [player, dispatchPlayerRaw] = useReducer((s: typeof initialPlayerState, a: PlayerAction & { count: number }) => reducePlayer(s, a, a.count), initialPlayerState);
  const [theme, setTheme] = useState<ThemeId>(() => resolveTheme(localStorage.getItem(THEME_STORAGE_KEY)));

  useEffect(() => { applyTheme(document.documentElement, theme); localStorage.setItem(THEME_STORAGE_KEY, theme); }, [theme]);

  const index = useMemo(() => indexScene(scene), [scene]);
  const localSet = useMemo(() => new Set(explorer.localExpanded), [explorer.localExpanded]);
  const collapsedSet = useMemo(() => new Set(explorer.localCollapsed), [explorer.localCollapsed]);
  const model = useMemo(
    () => computeVisible(scene, index, explorer.level, localSet, collapsedSet),
    [scene, index, explorer.level, localSet, collapsedSet],
  );
  const projected = useMemo(() => projectEdges(scene, model), [scene, model]);
  const openSet = useMemo(() => new Set(explorer.openSteps), [explorer.openSteps]);
  const flat = useMemo(() => flattenSteps(scene.steps, openSet), [scene, openSet]);
  const numbering = useMemo(() => numberSteps(scene.steps), [scene]);
  const byNode = useMemo(() => risksByNode(scene), [scene]);

  const dispatchPlayer = useCallback((action: PlayerAction) => dispatchPlayerRaw({ ...action, count: flat.length }), [flat.length]);
  usePlaybackClock(player.playing, (deltaMs) => dispatchPlayer({ type: 'tick', deltaMs }));

  const previousFlat = useRef(flat);
  useEffect(() => {
    if (previousFlat.current === flat) return;
    const next = resequenceCursor(previousFlat.current, flat, player.stepIndex, scene.steps);
    previousFlat.current = flat;
    if (next !== player.stepIndex) dispatchPlayer({ type: 'seek', stepIndex: next });
  }, [flat, player.stepIndex, scene.steps, dispatchPlayer]);

  const frame = useMemo(() => frameAt(model, projected, flat, player.stepIndex), [model, projected, flat, player.stepIndex]);
  const phase = stepPhase(player.progress, frame.active !== null);

  const selectedNode = explorer.selectedNodeId ? index.byId.get(explorer.selectedNodeId) ?? null : null;
  const selectedRisk = scene.risks.find((r) => r.id === explorer.selectedRiskId) ?? null;
  const codeNode = explorer.codeNodeId ? index.byId.get(explorer.codeNodeId) : undefined;
  const canOpenInside = Boolean(selectedNode && (index.children.get(selectedNode.id)?.length ?? 0) > 0 && !model.expanded.has(selectedNode.id));

  const loadScene = (id: string) => {
    previousFlat.current = [];
    const next = sampleRegistry[id];
    dispatchRaw({ type: 'loadScene', sceneId: id, level: explorer.level, mode: (next && availableModes(next)[0]) ?? 'walkthrough' });
    dispatchPlayer({ type: 'reset' });
  };

  return (
    <div className="ws">
      <TopBar
        scenes={sampleScenes} scene={scene} level={explorer.level} mode={explorer.mode} scaleOverlay={explorer.scaleOverlay} theme={theme}
        onSceneChange={loadScene} onLevel={(level) => dispatchRaw({ type: 'setLevel', level })} onMode={(mode) => dispatchRaw({ type: 'setMode', mode })}
        onToggleOverlay={() => dispatchRaw({ type: 'toggleScaleOverlay' })} onTheme={setTheme}
      />
      <div className="ws-body">
        <ExplorerPanel
          scene={scene} index={index} model={model} explorer={explorer} flat={flat} cursor={frame.index} numbering={numbering} byNode={byNode}
          onSelectNode={(id) => dispatchRaw({ type: 'selectNode', nodeId: id })} onToggleExpand={(id) => dispatchRaw({ type: 'toggleExpand', nodeId: id })}
          onSeek={(i) => dispatchPlayer({ type: 'seek', stepIndex: i })} onToggleStep={(id) => dispatchRaw({ type: 'toggleStep', stepId: id })}
          onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })} onSetMode={(mode) => dispatchRaw({ type: 'setMode', mode })}
        />
        <main className="ws-canvas">
          <Canvas
            scene={scene} index={index} model={model} projected={projected} frame={frame} phase={phase} explorer={explorer} byNode={byNode}
            onSelect={(id) => dispatchRaw({ type: 'selectNode', nodeId: id })} onToggleExpand={(id) => dispatchRaw({ type: 'toggleExpand', nodeId: id })}
            onOpenCode={(id) => dispatchRaw({ type: 'openCode', nodeId: id })} onOpenStep={(id) => dispatchRaw({ type: 'toggleStep', stepId: id })}
            onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })}
          />
          {codeNode && <CodeDrawer node={codeNode} onClose={() => dispatchRaw({ type: 'closeCode' })} />}
        </main>
        <Inspector
          frame={frame} selectedNode={selectedNode} risksForNode={selectedNode ? byNode.get(selectedNode.id) ?? [] : []}
          selectedRisk={selectedRisk} riskNodeLabels={selectedRisk ? selectedRisk.nodeIds.map((id) => index.byId.get(id)?.label ?? id) : []}
          canOpenInside={canOpenInside} onOpenInside={() => selectedNode && dispatchRaw({ type: 'toggleExpand', nodeId: selectedNode.id })}
          onViewCode={() => selectedNode && dispatchRaw({ type: 'openCode', nodeId: selectedNode.id })} onSelectRisk={(id) => dispatchRaw({ type: 'selectRisk', riskId: id })}
        />
      </div>
      <Footer state={player} stepCount={flat.length} path={frame.flat?.path ?? null} dispatch={dispatchPlayer} />
    </div>
  );
};
