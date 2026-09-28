import { applyTheme, resolveTheme, THEMES, themeTokens } from '../src/theme/themes';

describe('themes', () => {
  it('resolves user preference, then org default, then mission', () => {
    expect(resolveTheme('paper', 'studio')).toBe('paper');
    expect(resolveTheme(null, 'studio')).toBe('studio');
    expect(resolveTheme('neon', undefined)).toBe('mission');
    expect(resolveTheme()).toBe('mission');
  });

  it('defines every token for every theme', () => {
    const keys = Object.keys(themeTokens.mission).sort();
    THEMES.forEach((id) => expect(Object.keys(themeTokens[id]).sort()).toEqual(keys));
    expect(keys).toHaveLength(14);
  });

  it('applies tokens, data-theme and color-scheme to an element', () => {
    const el = document.createElement('div');
    applyTheme(el, 'paper');
    expect(el.dataset.theme).toBe('paper');
    expect(el.style.getPropertyValue('--bg')).toBe(themeTokens.paper['--bg']);
    expect(el.dataset.colorScheme).toBe('light');
    applyTheme(el, 'contrast');
    expect(el.style.getPropertyValue('--accent')).toBe('#ffea00');
    expect(el.dataset.colorScheme).toBe('dark');
  });
});
