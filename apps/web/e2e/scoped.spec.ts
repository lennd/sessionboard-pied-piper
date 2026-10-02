import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('rdi.uiLanguage', 'en');
    localStorage.removeItem('rdi.chatMode');
  });
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/explore$/);
});

test('the chat refuses questions that are not about the repositories', async ({ page }) => {
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-input').fill('¿Qué clima hace hoy?');
  await page.getByTestId('chat-send').click();
  await expect(page.getByTestId('chat-message-1')).toContainText('I can only help analyze the connected repositories');
  await expect(page.locator('[data-testid^="chat-scene-"]')).toHaveCount(0);
});

test('Plan mode turns a change request into a solution', async ({ page }) => {
  test.setTimeout(180_000);
  const session = (await (await page.request.get('/api/me')).json()) as { orgs?: { id: string }[]; csrfToken?: string };
  const demo = session.orgs ? session : ((await (await page.request.post('/api/dev/demo-session', { data: {} })).json()) as { orgs: { id: string }[]; csrfToken: string });
  const orgId = demo.orgs![0]!.id;
  for (const fullName of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await page.request.post(`/api/orgs/${orgId}/repos`, { data: { fullName }, headers: { 'x-csrf-token': demo.csrfToken! } });
  }
  await expect.poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[]).every((r) => r.status === 'ready'), { timeout: 120_000 }).toBe(true);
  await page.goto(`/orgs/${orgId}/explore`);
  await page.getByTestId('activity-chat').click();
  await page.getByTestId('chat-mode-plan').click();
  await expect(page.getByTestId('chat-mode-plan')).toHaveAttribute('aria-pressed', 'true');
  await page.getByTestId('chat-input').fill('I want order cancellation');
  await page.getByTestId('chat-send').click();
  await expect(page.locator('[data-testid^="chat-solution-open-"]').first()).toBeVisible();
});

test('the pull requests panel explains how to connect GitHub', async ({ page }) => {
  await page.getByTestId('activity-pulls').click();
  await expect(page.getByTestId('pulls-not-configured')).toContainText('Connect GitHub');
});
