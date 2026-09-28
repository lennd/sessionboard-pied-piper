import { sampleSceneRegistry } from '@rdi/scene';
import { renderHook, waitFor } from '@testing-library/react';
import { useSceneLayout } from '../src/canvas/useSceneLayout';

vi.mock('../src/canvas/layout', () => ({
  layoutScene: vi.fn(() => Promise.reject(new Error('elk exploded'))),
}));

describe('useSceneLayout', () => {
  it('surfaces layout failures instead of staying in the loading state', async () => {
    const { result } = renderHook(() => useSceneLayout(sampleSceneRegistry['speaker-sync-flow']!));
    expect(result.current).toEqual({ layout: null, error: null });
    await waitFor(() => expect(result.current).toEqual({ layout: null, error: 'elk exploded' }));
  });
});
