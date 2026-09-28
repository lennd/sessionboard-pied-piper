import { screen, waitFor } from '@testing-library/react';
import { Route, Routes } from 'react-router-dom';
import { apiFetch } from '../../src/shell/api';
import { SettingsLayout } from '../../src/shell/settings/SettingsLayout';
import { UsagePage } from '../../src/shell/settings/UsagePage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);

const render = (agent: object) => {
  api.mockImplementation(async (path) => (String(path).endsWith('/agent') ? agent : { repos: 2, repoLimit: 10, pieces: 40 }) as never);
  renderShell(
    <Routes><Route path=":orgId/settings" element={<SettingsLayout />}><Route path="*" element={<UsagePage />} /></Route></Routes>,
    { route: '/orgs/o1/settings/usage', path: '/orgs/*', session: sessionFixture() },
  );
};

beforeEach(() => api.mockReset());

describe('UsagePage', () => {
  it('shows the monthly agent token usage', async () => {
    render({ enabled: true, model: 'claude-opus-5', tokensUsed: 12_345, tokenBudget: 2_000_000 });
    await waitFor(() => expect(screen.getByTestId('usage-agent')).toHaveTextContent('12,345 of 2,000,000 tokens this month'));
  });

  it('says when the agent is not configured', async () => {
    render({ enabled: false, model: 'claude-opus-5', tokensUsed: 0, tokenBudget: 2_000_000 });
    await waitFor(() => expect(screen.getByTestId('usage-agent')).toHaveTextContent('Agent not configured'));
  });
});
