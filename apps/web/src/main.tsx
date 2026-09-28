import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { I18nProvider } from './i18n/I18nProvider';
import { Workspace } from './workspace/Workspace';

createRoot(document.getElementById('root') as HTMLElement).render(
  <StrictMode>
    <I18nProvider>
      <Workspace />
    </I18nProvider>
  </StrictMode>,
);
