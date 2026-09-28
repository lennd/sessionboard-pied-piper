import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  expect(demo.ok()).toBe(true);
  await page.goto('/');
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/explore$/);
  await page.getByTestId('scene-select').selectOption('checkout-en');
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('levels change both the explorer and the canvas', async ({ page }) => {
  await expect(page.getByTestId('tree-item-group:orders-api')).toBeVisible();
  await expect(page.getByTestId('node-reserve-stock')).toHaveCount(0);
  await page.getByTestId('level-components').click();
  await expect(page.getByTestId('node-reserve-stock')).toBeVisible();
  await page.getByTestId('level-detail').click();
  await expect(page.getByTestId('node-lock-rows')).toBeVisible();
  await page.getByTestId('level-system').click();
  await expect(page.getByTestId('node-repo:orders-api')).toBeVisible();
  await expect(page.getByTestId('tree-item-repo:orders-api')).toBeVisible();
});

test('walkthrough plays in order and pieces activate', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('player-counter')).toHaveText('Step 2 · 2 / 5');
  await expect(page.getByTestId('node-orders-queue')).toHaveClass(/is-focused/);
  await expect(page.getByTestId('edge-token')).toBeVisible();
  await expect(page.getByTestId('now')).toContainText('The API validates');
  await page.getByTestId('player-speed').selectOption('2');
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('player-counter')).toHaveText('Step 3 · 3 / 5', { timeout: 5000 });
  await expect(page.getByTestId('node-worker')).toHaveClass(/is-active|is-focused/);
});

test('opening a step reveals internal pieces and sub-steps', async ({ page }) => {
  await page.getByTestId('step-toggle-s3').click();
  await expect(page.getByTestId('step-s3-1')).toBeVisible();
  await expect(page.getByTestId('node-reserve-stock')).toBeVisible();
  await page.getByTestId('step-s3-1').click();
  await expect(page.getByTestId('player-counter')).toContainText('Step 3.1');
  await page.getByTestId('step-toggle-s3').click();
  await expect(page.getByTestId('node-reserve-stock')).toHaveCount(0);
  await expect(page.getByTestId('player-counter')).toContainText('Step 3 ·');
});

test('the component card shows scale rows and code stays optional', async ({ page }) => {
  await page.getByTestId('node-inventory').click();
  await expect(page.getByTestId('scale-row-high')).toContainText('saturated');
  await expect(page.getByTestId('card')).toContainText('Does not scale');
  await expect(page.getByTestId('code-drawer')).toHaveCount(0);
  await page.getByTestId('level-components').click();
  await page.getByTestId('node-reserve-stock').click();
  await page.getByTestId('view-code').click();
  await expect(page.getByTestId('code-drawer')).toContainText('src/worker/reserve.ts:8-14');
  await page.getByTestId('code-close').click();
  await expect(page.getByTestId('code-drawer')).toHaveCount(0);
});

test('selecting a risk on an internal piece expands its parents', async ({ page }) => {
  await page.getByTestId('level-system').click();
  await page.getByTestId('mode-risks').click();
  await page.getByTestId('risk-r-lock').click();
  await expect(page.getByTestId('level-architecture')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.getByTestId('node-lock-rows')).toHaveClass(/is-focused/);
  await expect(page.getByTestId('risk-detail')).toContainText('Lock contention');
});

test('theme and language are configurable', async ({ page }) => {
  await page.getByTestId('theme-select').selectOption('paper');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await page.getByTestId('language-select').selectOption('es');
  await expect(page.getByTestId('level-architecture')).toHaveText('Arquitectura');
  await expect(page.getByTestId('regenerate')).toBeVisible();
  await page.getByTestId('scene-select').selectOption('checkout-es');
  await expect(page.getByTestId('regenerate')).toHaveCount(0);
});

test('repo groups are labelled and edges connect pieces', async ({ page }) => {
  await expect(page.getByTestId('group-group:orders-api')).toContainText('orders-api');
  await expect(page.locator('.edge-line')).not.toHaveCount(0);
  await expect(page.locator('.edge-line').first()).toHaveAttribute('d', /^M [\d.]+ [\d.]+ L [\d.]+ [\d.]+$/);
});

test('closing a step while playing keeps the cursor in range', async ({ page }) => {
  await page.getByTestId('step-toggle-s3').click();
  await page.getByTestId('step-s3-1').click();
  await page.getByTestId('player-toggle').click();
  await page.getByTestId('step-toggle-s3').click();
  await expect(page.getByTestId('player-counter')).toHaveText(/Step 3 · 3 \/ 5|Step 4 · 4 \/ 5/);
});

test('scenes without changes do not offer the changes mode', async ({ page }) => {
  await page.getByTestId('scene-select').selectOption('iot-telemetry');
  await expect(page.getByTestId('node-broker')).toBeVisible();
  await expect(page.getByTestId('mode-changes')).toHaveCount(0);
  await expect(page.getByTestId('activity-changes')).toHaveCount(0);
});

test('a level-expanded piece can be collapsed from the explorer', async ({ page }) => {
  await page.getByTestId('level-components').click();
  await expect(page.getByTestId('node-reserve-stock')).toBeVisible();
  await page.getByTestId('tree-toggle-worker').click();
  await expect(page.getByTestId('node-reserve-stock')).toHaveCount(0);
});
