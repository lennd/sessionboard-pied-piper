import { expect, test, type APIRequestContext, type Page } from '@playwright/test';

const API = 'http://localhost:4040';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

const indexDemo = async (page: Page) => {
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  const orgId = orgs[0]!.id;
  for (const fullName of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await page.request.post(`/api/orgs/${orgId}/repos`, { data: { fullName }, headers: { 'x-csrf-token': csrfToken } });
  }
  await expect.poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[]).every((r) => r.status === 'ready'), { timeout: 120_000 }).toBe(true);
  return { orgId, csrfToken };
};

const mcp = async (request: APIRequestContext, token: string, name: string, args: object) => {
  const res = await request.post(`${API}/mcp`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/json, text/event-stream', 'content-type': 'application/json' },
    data: { jsonrpc: '2.0', id: Date.now(), method: 'tools/call', params: { name, arguments: args } },
  });
  return ((await res.json()) as { result: { content: { text: string }[]; isError?: boolean } }).result;
};

test('design a solution in the chat and let Claude Code report progress live', async ({ page }) => {
  test.setTimeout(240_000);
  const { orgId, csrfToken } = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-input').fill('I want order cancellation');
  await page.getByTestId('chat-send').click();
  const open = page.locator('[data-testid^="chat-solution-open-"]').first();
  await expect(open).toBeVisible();
  await open.click();

  await expect(page.getByTestId('plan-panel')).toBeVisible();
  await expect(page.locator('[data-testid^="plan-task-status-"]').first()).toContainText('to do');
  const solutionId = page.url().split('/solutions/')[1]!;
  await page.locator('[data-testid^="plan-task-"]:not([data-testid^="plan-task-status-"])').first().click();
  await expect(page.getByTestId('card')).not.toHaveText('');

  await page.getByTestId('plan-execute').click();
  await page.getByTestId('handoff-create-token').click();
  await expect(page.getByTestId('handoff-mcp-command')).toContainText('Bearer rdi_');
  const command = await page.getByTestId('handoff-mcp-command').innerText();
  const token = /Bearer (rdi_\S+)"/.exec(command)![1]!;
  await page.getByTestId('handoff-close').click();

  const solution = JSON.parse((await mcp(page.request, token, 'get_solution', { id: solutionId })).content[0]!.text) as { plan: { id: string }[] };
  await mcp(page.request, token, 'report_task_progress', { id: solutionId, taskId: solution.plan[0]!.id, status: 'done', note: 'PR #1' });
  await expect(page.getByTestId(`plan-task-status-${solution.plan[0]!.id}`)).toContainText('done');
  await expect(page.getByTestId(`plan-task-${solution.plan[0]!.id}`)).toContainText('PR #1');

  await mcp(page.request, token, 'update_solution', { id: solutionId, summary: 'Refined by Claude Code' });
  await expect(page.getByTestId('plan-author')).toContainText('by Claude Code');
  await expect(page.getByTestId('plan-version')).toHaveValue('2');

  await page.goto(`/orgs/${orgId}/settings/solutions`);
  await expect(page.getByTestId(`solution-${solutionId}`)).toContainText('v2');
  expect(csrfToken).toBeTruthy();
});
