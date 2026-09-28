import { render, screen } from '@testing-library/react';
import type { NodeProps } from '@xyflow/react';
import { SceneGroup } from '../src/canvas/SceneGroup';

describe('SceneGroup', () => {
  it('renders the group label', () => {
    render(<SceneGroup {...({ id: 'g-api', data: { label: 'web-api' } } as unknown as NodeProps)} />);
    expect(screen.getByTestId('group-g-api')).toHaveTextContent('web-api');
  });
});
