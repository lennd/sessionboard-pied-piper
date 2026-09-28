import type { Scene, SceneInput } from '../schema';
import { validateScene } from '../validate';

export const defineScene = (input: SceneInput): Scene => {
  const result = validateScene(input);
  if (!result.ok) throw new Error(`Invalid scene "${input.id}":\n${result.errors.join('\n')}`);
  return result.scene;
};
