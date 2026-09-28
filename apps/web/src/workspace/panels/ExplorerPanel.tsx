import type { FlatStep, Scene, SceneIndex, SceneRisk, VisibleModel } from '@rdi/scene';
import { useI18n } from '../../i18n/I18nProvider';
import type { ExplorerState, Mode } from '../engine/explorerState';
import { buildExplorerTree } from './explorerTree';
import { PayloadDiff } from './PayloadDiff';
import { RisksPanel } from './RisksPanel';
import { availableModes } from './TopBar';
import { WalkthroughTree } from './WalkthroughTree';

type ExplorerPanelProps = {
  scene: Scene; index: SceneIndex; model: VisibleModel; explorer: ExplorerState; flat: FlatStep[]; cursor: number;
  numbering: Map<string, string>; byNode: Map<string, SceneRisk[]>;
  onSelectNode: (id: string) => void; onToggleExpand: (id: string) => void; onSeek: (index: number) => void;
  onToggleStep: (id: string) => void; onSelectRisk: (id: string) => void; onSetMode: (mode: Mode) => void;
};

const ACTIVITY: { mode: Mode; glyph: string }[] = [
  { mode: 'walkthrough', glyph: '▤' },
  { mode: 'risks', glyph: '⚠' },
  { mode: 'changes', glyph: '±' },
];

export const ExplorerPanel = (p: ExplorerPanelProps) => {
  const { t } = useI18n();
  const items = buildExplorerTree(p.scene, p.index, p.model, p.byNode);
  const selectedRep = p.explorer.selectedNodeId ? p.model.representative.get(p.explorer.selectedNodeId) : null;

  return (
    <>
      <nav className="ws-activity" aria-label={t('explorer.title')}>
        {ACTIVITY.filter(({ mode }) => availableModes(p.scene).includes(mode)).map(({ mode, glyph }) => (
          <button key={mode} type="button" data-testid={`activity-${mode}`} aria-pressed={p.explorer.mode === mode} title={t(`mode.${mode}`)} onClick={() => p.onSetMode(mode)}>
            {glyph}
          </button>
        ))}
      </nav>
      <aside className="ws-explorer">
        <div className="sec-title">{t('explorer.title')} · {t(`level.${p.explorer.level}`)}</div>
        <div className="tree">
          {items.map((item) => {
            const selected = item.nodeId !== null && (item.nodeId === p.explorer.selectedNodeId || item.id === selectedRep);
            const classes = ['tree-item', item.nodeId === null && 'is-group', selected && 'is-selected'].filter(Boolean).join(' ');
            return (
              <div key={item.id} className={classes} style={{ paddingLeft: 10 + item.depth * 14 }} data-testid={`tree-item-${item.id}`}>
                {item.expandable && item.nodeId ? (
                  <button type="button" className="twisty" data-testid={`tree-toggle-${item.id}`} aria-expanded={item.expanded} aria-label={item.expanded ? t('explorer.collapse') : t('explorer.expand')} onClick={(e) => { e.stopPropagation(); p.onToggleExpand(item.id); }}>
                    {item.expanded ? '▾' : '▸'}
                  </button>
                ) : (
                  <span className="twisty">{item.nodeId === null ? '▾' : ''}</span>
                )}
                {item.nodeId ? (
                  <button type="button" className="tree-label" aria-pressed={selected} onClick={() => p.onSelectNode(item.nodeId as string)}>
                    {item.glyph} {item.label}
                  </button>
                ) : (
                  <span>{item.glyph} {item.label}</span>
                )}
                {item.severity && <span className={`risk-dot sev-${item.severity}`} />}
              </div>
            );
          })}
        </div>
        {p.explorer.mode === 'risks' ? (
          <>
            <div className="sec-title">{t('explorer.risks')}</div>
            <RisksPanel scene={p.scene} selectedRiskId={p.explorer.selectedRiskId} onSelect={p.onSelectRisk} />
          </>
        ) : (
          <>
            <div className="sec-title">{t('explorer.walkthrough')}</div>
            <WalkthroughTree steps={p.scene.steps} numbering={p.numbering} flat={p.flat} cursor={p.cursor} openSteps={p.explorer.openSteps} onSeek={p.onSeek} onToggle={p.onToggleStep} />
            <PayloadDiff payload={p.flat[p.cursor]?.step.payload} />
          </>
        )}
      </aside>
    </>
  );
};
