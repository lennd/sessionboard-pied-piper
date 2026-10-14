import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme, effectiveUiLanguage } from '../../src/shell/preferences';
import { prefsFixture } from './render';

describe('preference precedence', () => {
  it('prefers the stored preference, then the fallback', () => {
    expect(effectiveUiLanguage(prefsFixture({ uiLanguage: 'pt' }), 'en')).toBe('pt');
    expect(effectiveUiLanguage(prefsFixture(), 'en')).toBe('en');
    expect(effectiveUiLanguage(undefined, 'es')).toBe('es');
    expect(effectiveExplanationLanguage(prefsFixture({ explanationLanguage: 'pt' }), 'en')).toBe('pt');
    expect(effectiveExplanationLanguage(prefsFixture({ uiLanguage: 'es' }), 'en')).toBe('es');
    expect(effectiveExplanationLanguage(undefined, 'es')).toBe('es');
    expect(effectiveTheme(prefsFixture({ theme: 'paper' }))).toBe('paper');
    expect(effectiveTheme(undefined)).toBe('piper');
    expect(effectiveLevel(prefsFixture({ initialLevel: 'detail' }))).toBe('detail');
    expect(effectiveLevel(prefsFixture())).toBe('architecture');
  });
});
