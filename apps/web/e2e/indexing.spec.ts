import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

test('connect the demo repositories, index them and explore the generated system map', async ({ page }) => {
  test.setTimeout(180_000);
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const orgId = ((await demo.json()) as { orgs: { id: string }[] }).orgs[0]!.id;
  await page.goto(`/orgs/${orgId}/settings/repositories`);
  await expect(page.getByTestId('demo-hint')).toBeVisible();
  for (const name of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await page.getByTestId('add-repo-select').selectOption(name);
    await page.getByTestId('add-repo-submit').click();
    await expect(page.getByTestId(`repo-${name}`)).toBeVisible();
  }
  for (const name of ['acme-demo/shop-web', 'acme-demo/shop-api', 'acme-demo/shop-worker']) {
    await expect(page.getByTestId(`stage-${name}-link`)).toHaveClass(/done/, { timeout: 120_000 });
  }
  await expect(page.getByTestId('stage-acme-demo/shop-api-detect')).toHaveAttribute('title', '2 endpoints · 1 queues · 1 tables');
  await page.getByTestId('nav-usage').click();
  await expect(page.getByTestId('usage-repos')).toContainText('3 / 10');

  await page.getByTestId('nav-explore').click();
  await expect(page.getByTestId('scene-select')).toHaveValue('system-map');
  await expect(page.getByText('shop-api', { exact: true }).first()).toBeVisible();
  await page.getByTestId('level-components').click();
  await expect(page.getByText('POST /api/orders', { exact: true }).first()).toBeVisible();
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('now')).toContainText('shop-api publishes a message to the "orders" queue.');
});

test('removing a repository updates the map', async ({ page }) => {
  test.setTimeout(180_000);
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  const orgId = orgs[0]!.id;
  const headers = { 'x-csrf-token': csrfToken };
  const added = await page.request.post(`/api/orgs/${orgId}/repos`, { data: { fullName: 'acme-demo/shop-api' }, headers });
  const repoId = ((await added.json()) as { id: string }).id;
  await expect.poll(async () => ((await (await page.request.get(`/api/orgs/${orgId}/repos`)).json()) as { status: string }[])[0]?.status, { timeout: 120_000 }).toBe('ready');
  expect((await page.request.get(`/api/orgs/${orgId}/system-map`)).status()).toBe(200);
  await page.request.delete(`/api/orgs/${orgId}/repos/${repoId}`, { headers });
  expect((await page.request.get(`/api/orgs/${orgId}/system-map`)).status()).toBe(404);
});
