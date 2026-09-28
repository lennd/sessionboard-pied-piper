import { renderHook, waitFor } from '@testing-library/react';
import { useSceneLayout } from '../../src/workspace/canvas/useSceneLayout';

describe('useSceneLayout', () => {
  it('resolves the layout for the current signature', async () => {
    const layout = { boxes: new Map(), order: [] };
    const { result } = renderHook(() => useSceneLayout('a', () => Promise.resolve(layout)));
    expect(result.current).toEqual({ layout: null, error: null });
    await waitFor(() => expect(result.current.layout).toBe(layout));
  });

  it('surfaces failures', async () => {
    const { result } = renderHook(() => useSceneLayout('b', () => Promise.reject(new Error('elk exploded'))));
    await waitFor(() => expect(result.current).toEqual({ layout: null, error: 'elk exploded' }));
  });
});
