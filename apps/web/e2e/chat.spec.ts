import { expect, test, type Page } from '@playwright/test';

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
  await expect
    .poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[]).every((r) => r.status === 'ready'), { timeout: 120_000 })
    .toBe(true);
  return { orgId, csrfToken };
};

const ask = async (page: Page, text: string) => {
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-input').fill(text);
  await page.getByTestId('chat-send').click();
};

test('ask the agent and watch the answer animate on the canvas', async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId } = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await expect(page.getByTestId('scene-select')).toHaveValue('system-map');
  await ask(page, 'orders');
  await expect(page.getByTestId('chat-message-1')).toContainText('Here is how it fits together');
  await expect(page.locator('[data-testid^="chat-scene-"]').first()).toContainText('Scene: About');
  await expect(page.getByTestId('scene-select')).not.toHaveValue('system-map');
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('now')).toContainText('Step 2:');

  await page.reload();
  await page.getByTestId('activity-chat').click();
  await expect(page.getByTestId('chat-message-0')).toContainText('orders');
  await expect(page.locator('[data-testid^="chat-scene-"]').first()).toBeVisible();
});

test('regenerate a scene in another explanation language', async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId, csrfToken } = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await ask(page, 'orders');
  await expect(page.locator('[data-testid^="chat-scene-"]').first()).toBeVisible();
  await expect(page.locator('[data-testid^="chat-translate-"]')).toHaveCount(0);

  await page.request.patch('/api/me', { data: { explanationLanguage: 'pt' }, headers: { 'x-csrf-token': csrfToken } });
  await page.reload();
  await page.getByTestId('activity-chat').click();
  await page.locator('[data-testid^="chat-translate-"]').first().click();
  await expect(page.locator('[data-testid="scene-select"] option:checked')).toContainText('(pt)');
  await expect(page.locator('[data-testid^="chat-scene-"]')).toHaveCount(2);
});

test('open real code from the system map', async ({ page }) => {
  test.setTimeout(180_000);
  const { orgId } = await indexDemo(page);
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('level-components').click();
  await page.locator('.tree-label', { hasText: 'POST /api/orders' }).first().click();
  await page.getByTestId('view-code').click();
  await expect(page.getByTestId('code-drawer')).toContainText("app.post('/api/orders', createOrderHandler);");
});
