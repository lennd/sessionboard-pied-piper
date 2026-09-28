import type { Scene } from '@rdi/scene';

type NarrationPanelProps = { scene: Scene; stepIndex: number; onSeek: (index: number) => void };

export const NarrationPanel = ({ scene, stepIndex, onSeek }: NarrationPanelProps) => (
  <section className="narration">
    <h2>{scene.title}</h2>
    {scene.steps.length === 0 ? (
      <p className="narration__empty">This scene has no walkthrough — explore the canvas directly.</p>
    ) : (
      <ol>
        {scene.steps.map((step, i) => (
          <li key={i}>
            <button
              type="button"
              data-testid={`narration-step-${i}`}
              aria-current={i === stepIndex ? 'step' : undefined}
              className={i === stepIndex ? 'narration__step narration__step--current' : 'narration__step'}
              onClick={() => onSeek(i)}
            >
              {step.narration}
            </button>
          </li>
        ))}
      </ol>
    )}
  </section>
);
