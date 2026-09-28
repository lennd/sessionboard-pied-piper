import type { Scene } from '@rdi/scene';

type SceneTabsProps = { scenes: Scene[]; activeId: string; onSelect: (id: string) => void };

export const SceneTabs = ({ scenes, activeId, onSelect }: SceneTabsProps) => (
  <div role="tablist" className="tabs">
    {scenes.map((scene) => (
      <button
        key={scene.id}
        role="tab"
        type="button"
        data-testid={`tab-${scene.id}`}
        aria-selected={scene.id === activeId}
        className={scene.id === activeId ? 'tabs__tab tabs__tab--active' : 'tabs__tab'}
        onClick={() => onSelect(scene.id)}
      >
        <span className={`tabs__kind tabs__kind--${scene.kind}`}>{scene.kind}</span> {scene.title}
      </button>
    ))}
  </div>
);
