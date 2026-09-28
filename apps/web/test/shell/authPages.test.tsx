import { fireEvent, screen, waitFor } from '@testing-library/react';
import { StrictMode } from 'react';
import { ApiError, apiFetch } from '../../src/shell/api';
import { CheckEmailPage } from '../../src/shell/pages/CheckEmailPage';
import { ForgotPage } from '../../src/shell/pages/ForgotPage';
import { InvitePage } from '../../src/shell/pages/InvitePage';
import { LoginPage } from '../../src/shell/pages/LoginPage';
import { ResetPage } from '../../src/shell/pages/ResetPage';
import { SignupPage } from '../../src/shell/pages/SignupPage';
import { VerifyPage } from '../../src/shell/pages/VerifyPage';
import { renderShell, sessionFixture } from './render';

vi.mock('../../src/shell/api', async (original) => ({ ...(await original<typeof import('../../src/shell/api')>()), apiFetch: vi.fn() }));
const api = vi.mocked(apiFetch);
beforeEach(() => api.mockReset());

const type = (testid: string, value: string) => fireEvent.change(screen.getByTestId(testid), { target: { value } });

describe('LoginPage', () => {
  it('signs in and follows a safe next parameter', async () => {
    api.mockResolvedValueOnce(sessionFixture());
    renderShell(<LoginPage />, { route: '/login?next=/orgs/o1/settings', path: '/login' });
    type('login-email', 'ana@acme.com');
    type('login-password', 'correct horse battery');
    fireEvent.click(screen.getByTestId('login-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/settings'));
    expect(api).toHaveBeenCalledWith('/auth/login', { method: 'POST', body: { email: 'ana@acme.com', password: 'correct horse battery' } });
  });

  it('shows the generic error and offers resending verification', async () => {
    api.mockRejectedValueOnce(new ApiError(403, 'email_not_verified')).mockResolvedValueOnce({ ok: true });
    renderShell(<LoginPage />, { route: '/login', path: '/login' });
    type('login-email', 'ana@acme.com');
    type('login-password', 'x');
    fireEvent.click(screen.getByTestId('login-submit'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('Verify your email before signing in.');
    fireEvent.click(screen.getByTestId('resend-verification'));
    await waitFor(() => expect(api).toHaveBeenLastCalledWith('/auth/resend-verification', { method: 'POST', body: { email: 'ana@acme.com' } }));
  });
});

describe('SignupPage', () => {
  it('shows server validation and moves to check-email on success', async () => {
    api.mockRejectedValueOnce(new ApiError(400, 'weak_password')).mockResolvedValueOnce({ ok: true });
    renderShell(<SignupPage />, { route: '/signup', path: '/signup' });
    type('signup-name', 'Ana');
    type('signup-email', 'ana@acme.com');
    type('signup-password', 'short');
    fireEvent.click(screen.getByTestId('signup-submit'));
    expect(await screen.findByTestId('form-error')).toHaveTextContent('at least 12 characters');
    type('signup-password', 'correct horse battery');
    fireEvent.click(screen.getByTestId('signup-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/check-email?email=ana%40acme.com'));
  });
});

describe('CheckEmailPage', () => {
  it('shows the address and resends', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<CheckEmailPage />, { route: '/check-email?email=ana%40acme.com', path: '/check-email' });
    expect(screen.getByText(/ana@acme.com/)).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('resend-verification'));
    expect(await screen.findByText('Sent again ✓')).toBeInTheDocument();
  });
});

describe('VerifyPage', () => {
  it('verifies exactly once even in StrictMode', async () => {
    api.mockResolvedValue({ ok: true });
    renderShell(<StrictMode><VerifyPage /></StrictMode>, { route: '/verify?token=abcdefghijkl', path: '/verify' });
    await waitFor(() => expect(screen.getByTestId('verify-status')).toHaveTextContent('Email verified'));
    expect(api).toHaveBeenCalledTimes(1);
  });

  it('reports invalid links', async () => {
    api.mockRejectedValueOnce(new ApiError(400, 'invalid_token'));
    renderShell(<VerifyPage />, { route: '/verify?token=abcdefghijkl', path: '/verify' });
    await waitFor(() => expect(screen.getByTestId('verify-status')).toHaveTextContent('invalid or has expired'));
  });
});

describe('ForgotPage and ResetPage', () => {
  it('always confirms the forgot request', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<ForgotPage />, { route: '/forgot', path: '/forgot' });
    type('forgot-email', 'ana@acme.com');
    fireEvent.click(screen.getByTestId('forgot-submit'));
    expect(await screen.findByTestId('forgot-sent')).toBeInTheDocument();
  });

  it('resets and returns to sign in', async () => {
    api.mockResolvedValueOnce({ ok: true });
    renderShell(<ResetPage />, { route: '/reset?token=abcdefghijkl', path: '/reset' });
    type('reset-password', 'brand new passphrase');
    fireEvent.click(screen.getByTestId('reset-submit'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/login?reset=1'));
    expect(api).toHaveBeenCalledWith('/auth/reset', { method: 'POST', body: { token: 'abcdefghijkl', password: 'brand new passphrase' } });
  });
});

describe('InvitePage', () => {
  it('lets a signed-in user accept', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'member', status: 'valid' }).mockResolvedValueOnce({ orgId: 'o1' }).mockResolvedValue(sessionFixture());
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: sessionFixture() });
    fireEvent.click(await screen.findByTestId('invite-accept'));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/orgs/o1/explore'));
  });

  it('asks anonymous users to sign in with a return path', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'admin', status: 'valid' });
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: null });
    expect(await screen.findByTestId('invite-signin')).toHaveAttribute('href', '/login?next=%2Finvite%2Ftok123');
  });

  it('explains unavailable invitations', async () => {
    api.mockResolvedValueOnce({ orgName: 'Acme', email: 'ana@acme.com', role: 'admin', status: 'expired' });
    renderShell(<InvitePage />, { route: '/invite/tok123', path: '/invite/:token', session: null });
    expect(await screen.findByTestId('invite-unavailable')).toBeInTheDocument();
  });
});
