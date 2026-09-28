import { effectiveExplanationLanguage, effectiveLevel, effectiveTheme, effectiveUiLanguage, safeNext } from '../../src/shell/preferences';
import type { SessionOrg, SessionUser } from '../../src/shell/session';

const user = (patch: Partial<SessionUser> = {}): SessionUser => ({ id: 'u', email: 'a@b.c', name: 'A', uiLanguage: null, explanationLanguage: null, theme: null, initialLevel: null, ...patch });
const org = (patch: Partial<SessionOrg> = {}): SessionOrg => ({ id: 'o', name: 'Acme', slug: 'acme', role: 'owner', defaultUiLanguage: 'es', defaultExplanationLanguage: 'pt', defaultTheme: 'studio', ...patch });

describe('preference precedence', () => {
  it('prefers the user, then the org, then the fallback', () => {
    expect(effectiveUiLanguage(user({ uiLanguage: 'pt' }), org(), 'en')).toBe('pt');
    expect(effectiveUiLanguage(user(), org(), 'en')).toBe('es');
    expect(effectiveUiLanguage(user(), null, 'en')).toBe('en');
    expect(effectiveExplanationLanguage(user(), org(), 'en')).toBe('pt');
    expect(effectiveExplanationLanguage(user(), null, 'es')).toBe('es');
    expect(effectiveTheme(user({ theme: 'paper' }), org())).toBe('paper');
    expect(effectiveTheme(user(), org())).toBe('studio');
    expect(effectiveTheme(user(), null)).toBe('mission');
    expect(effectiveLevel(user({ initialLevel: 'detail' }))).toBe('detail');
    expect(effectiveLevel(user())).toBe('architecture');
  });
});

describe('safeNext', () => {
  it('only allows same-origin paths', () => {
    expect(safeNext('/orgs/1/explore')).toBe('/orgs/1/explore');
    expect(safeNext('//evil.com')).toBe('/');
    expect(safeNext('https://evil.com')).toBe('/');
    expect(safeNext(null)).toBe('/');
  });
});
