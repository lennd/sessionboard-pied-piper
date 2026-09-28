import { act, render, screen } from '@testing-library/react';
import { I18nProvider, useI18n } from '../src/i18n/I18nProvider';
import { detectLanguage, messages, primarySubtag, translate } from '../src/i18n/messages';

describe('translate', () => {
  it('returns the catalog string and interpolates params', () => {
    expect(translate('es', 'level.architecture')).toBe('Arquitectura');
    expect(translate('en', 'callout.risks', { count: 2 })).toBe('2 risks');
  });

  it('falls back to English when a key is missing in the language', () => {
    const key = 'level.system';
    const original = messages.pt[key];
    delete messages.pt[key];
    expect(translate('pt', key)).toBe('System');
    messages.pt[key] = original;
  });

  it('keeps every es and pt key present in en', () => {
    Object.keys(messages.es).forEach((k) => expect(messages.en).toHaveProperty(k));
    Object.keys(messages.pt).forEach((k) => expect(messages.en).toHaveProperty(k));
  });
});

describe('detectLanguage', () => {
  it('prefers a stored supported value, then the browser language, then English', () => {
    expect(detectLanguage('pt', 'es-AR')).toBe('pt');
    expect(detectLanguage('xx', 'es-AR')).toBe('es');
    expect(detectLanguage(null, 'pt-BR')).toBe('pt');
    expect(detectLanguage(null, 'de-DE')).toBe('en');
    expect(primarySubtag('pt-BR')).toBe('pt');
  });
});

const Probe = () => {
  const { t, setLanguage, language } = useI18n();
  return (
    <button type="button" onClick={() => setLanguage('es')} data-lang={language}>
      {t('level.components')}
    </button>
  );
};

describe('I18nProvider', () => {
  it('switches language without reload and persists it', () => {
    render(
      <I18nProvider initialLanguage="en">
        <Probe />
      </I18nProvider>,
    );
    expect(screen.getByRole('button')).toHaveTextContent('Components');
    act(() => screen.getByRole('button').click());
    expect(screen.getByRole('button')).toHaveTextContent('Componentes');
    expect(localStorage.getItem('rdi.uiLanguage')).toBe('es');
  });
});
