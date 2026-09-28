import { expect, test } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('steps through the flow with a travelling token and synced narration', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await expect(page.getByTestId('player-counter')).toHaveText('2 / 6');
  await expect(page.getByTestId('node-sync-endpoint')).toHaveClass(/scene-node--focused/);
  await expect(page.getByTestId('narration-step-1')).toHaveAttribute('aria-current', 'step');
  await expect(page.getByTestId('edge-token')).toBeVisible();
  await expect(page.getByTestId('payload-panel')).toContainText('integrationId');
});

test('plays automatically to the next step', async ({ page }) => {
  await page.getByTestId('player-speed').selectOption('2');
  await page.getByTestId('player-toggle').click();
  await expect(page.getByTestId('player-counter')).toHaveText('2 / 6', { timeout: 5000 });
});

test('zooms into the worker algorithm and back', async ({ page }) => {
  await page.getByTestId('node-worker').dblclick();
  await expect(page.getByTestId('crumb-1')).toHaveText('Reconciliation algorithm (inside the sync worker)');
  await expect(page.getByTestId('node-diff')).toBeVisible();
  await page.getByTestId('crumb-0').click();
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('resets playback when switching scenes mid-playback', async ({ page }) => {
  await page.getByTestId('player-next').click();
  await page.getByTestId('player-next').click();
  await page.getByTestId('tab-speaker-reconcile-algorithm').click();
  await expect(page.getByTestId('player-counter')).toHaveText('1 / 6');
  await expect(page.getByTestId('player-toggle')).toHaveAccessibleName('Play');
});

test('saturates the queue when traffic grows', async ({ page }) => {
  await page.getByTestId('tab-speaker-sync-load').click();
  await expect(page.getByTestId('node-queue')).not.toHaveClass(/scene-node--saturated/);
  await page.getByTestId('load-rps').fill('30');
  await expect(page.getByTestId('node-queue')).toHaveClass(/scene-node--saturated/);
  await expect(page.getByTestId('load-bottlenecks')).toContainText('jobs queue');
  await expect(page.getByTestId('player-counter')).toHaveText('No steps');
});

test('highlights changed nodes in the diff-impact scene', async ({ page }) => {
  await page.getByTestId('tab-pr-impact').click();
  await expect(page.getByTestId('node-speaker-mapper')).toHaveClass(/scene-node--change-added/);
  await expect(page.getByTestId('node-web')).toHaveClass(/scene-node--dim/);
});
