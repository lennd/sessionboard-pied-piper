import { expect, test, type APIRequestContext } from '@playwright/test';

const PASSWORD = 'correct horse battery';
const unique = (prefix: string) => `${prefix}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.com`;

const lastLink = async (request: APIRequestContext, email: string, kind: 'verify' | 'reset' | 'invite') => {
  const res = await request.get(`/api/dev/mailbox?to=${encodeURIComponent(email)}`);
  const { messages } = (await res.json()) as { messages: { kind: string; link: string }[] };
  const link = messages.filter((m) => m.kind === kind).at(-1)?.link;
  if (!link) throw new Error(`no ${kind} mail for ${email}`);
  return new URL(link).pathname + new URL(link).search;
};

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('rdi.uiLanguage', 'en'));
});

test('sign up, verify, sign in, create an organization and land in the workspace', async ({ page }) => {
  const email = unique('ana');
  await page.goto('/signup');
  await expect(page.getByTestId('animated-logo').first()).toBeVisible();
  await page.getByTestId('signup-name').fill('Ana');
  await page.getByTestId('signup-email').fill(email);
  await page.getByTestId('signup-password').fill(PASSWORD);
  await page.getByTestId('signup-submit').click();
  await expect(page).toHaveURL(/\/check-email/);
  await page.goto(await lastLink(page.request, email, 'verify'));
  await expect(page.getByTestId('verify-status')).toContainText('Email verified');
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL(/\/onboarding$/);
  await page.getByTestId('onboarding-name').fill('Acme');
  await page.getByTestId('onboarding-submit').click();
  await expect(page).toHaveURL(/\/orgs\/[^/]+\/explore$/);
  await expect(page.getByTestId('node-worker')).toBeVisible();
});

test('wrong password shows the generic error', async ({ page }) => {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(unique('nobody'));
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('form-error')).toHaveText('Email or password is incorrect.');
});

test('invitations can be sent and revoked from members', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-members').click();
  const invitee = unique('sofi');
  await page.getByTestId('invite-email').fill(invitee);
  await page.getByTestId('invite-submit').click();
  const row = page.locator('[data-testid^="invitation-"]', { hasText: invitee }).first();
  await expect(row).toBeVisible();
  expect(await lastLink(page.request, invitee, 'invite')).toMatch(/^\/invite\//);
  await row.locator('[data-testid^="invitation-revoke-"]').click();
  await expect(page.locator('[data-testid^="invitation-"]', { hasText: invitee })).toHaveCount(0);
});

test('preferences change the UI language and the workspace theme', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-preferences').click();
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH'),
    page.getByTestId('pref-ui-es').click(),
  ]);
  await expect(page.getByTestId('nav-preferences')).toHaveText('Preferencias');
  await Promise.all([
    page.waitForResponse((r) => r.url().endsWith('/api/me') && r.request().method() === 'PATCH'),
    page.getByTestId('pref-theme-paper').click(),
  ]);
  await page.reload();
  await expect(page.getByTestId('nav-preferences')).toHaveText('Preferencias');
  await page.getByTestId('nav-explore').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'paper');
  await expect(page.getByTestId('level-architecture')).toHaveText('Arquitectura');
});

test('repositories show indexing stages', async ({ page }) => {
  const demo = await page.request.post('/api/dev/demo-session', { data: {} });
  const { orgs, csrfToken } = (await demo.json()) as { orgs: { id: string }[]; csrfToken: string };
  await page.request.post(`/api/dev/orgs/${orgs[0]!.id}/seed-repos`, { data: {}, headers: { 'x-csrf-token': csrfToken } });
  await page.goto(`/orgs/${orgs[0]!.id}/settings/repositories`);
  await expect(page.getByTestId('repo-acme/orders-api')).toBeVisible();
  await expect(page.getByTestId('stage-acme/orders-api-summarize')).toContainText('64%');
  await expect(page.getByTestId('stage-acme/ml-ranker-parse')).toHaveClass(/error/);
  await expect(page.getByTestId('connect-github')).toBeDisabled();
});

test('password change keeps this session and the new password works', async ({ page, browser }) => {
  const email = unique('pw');
  await page.request.post('/api/auth/signup', { data: { email, name: 'Pw', password: PASSWORD } });
  const verify = new URL(`http://x${await lastLink(page.request, email, 'verify')}`).searchParams.get('token');
  await page.request.post('/api/auth/verify', { data: { token: verify } });
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(PASSWORD);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('onboarding-name').fill('Pw Org');
  await page.getByTestId('onboarding-submit').click();
  await page.getByTestId('home-link').click();
  await page.getByTestId('nav-security').click();
  await page.getByTestId('password-current').fill(PASSWORD);
  await page.getByTestId('password-new').fill('fresh passphrase 99');
  await page.getByTestId('password-submit').click();
  await expect(page.getByTestId('password-updated')).toBeVisible();
  const fresh = await browser.newContext({ baseURL: 'http://localhost:5177' });
  const login = await fresh.request.post('/api/auth/login', { data: { email, password: 'fresh passphrase 99' } });
  expect(login.ok()).toBe(true);
  await fresh.close();
});

test('signing out returns to the sign-in screen', async ({ page }) => {
  await page.request.post('/api/dev/demo-session', { data: {} });
  await page.goto('/');
  await page.getByTestId('home-link').click();
  await page.getByTestId('sign-out').click();
  await expect(page).toHaveURL(/\/login$/);
  await page.goto('/');
  await expect(page).toHaveURL(/\/login/);
});
