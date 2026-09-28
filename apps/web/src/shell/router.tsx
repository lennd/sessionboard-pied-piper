import { createBrowserRouter, Navigate } from 'react-router-dom';
import { HomeRedirect, RequireAuth } from './guards';
import { AuthLayout } from './layouts/AuthLayout';
import { CheckEmailPage } from './pages/CheckEmailPage';
import { ExplorePage } from './pages/ExplorePage';
import { ForgotPage } from './pages/ForgotPage';
import { InvitePage } from './pages/InvitePage';
import { LoginPage } from './pages/LoginPage';
import { OnboardingPage } from './pages/OnboardingPage';
import { ResetPage } from './pages/ResetPage';
import { SignupPage } from './pages/SignupPage';
import { VerifyPage } from './pages/VerifyPage';
import { GeneralPage } from './settings/GeneralPage';
import { MembersPage } from './settings/MembersPage';
import { PreferencesPage } from './settings/PreferencesPage';
import { RepositoriesPage } from './settings/RepositoriesPage';
import { SecurityPage } from './settings/SecurityPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { UsagePage } from './settings/UsagePage';

export const router = createBrowserRouter([
  { path: '/', element: <HomeRedirect /> },
  {
    element: <AuthLayout />,
    children: [
      { path: '/login', element: <LoginPage /> },
      { path: '/signup', element: <SignupPage /> },
      { path: '/check-email', element: <CheckEmailPage /> },
      { path: '/verify', element: <VerifyPage /> },
      { path: '/forgot', element: <ForgotPage /> },
      { path: '/reset', element: <ResetPage /> },
      { path: '/invite/:token', element: <InvitePage /> },
    ],
  },
  {
    element: <RequireAuth />,
    children: [
      { path: '/onboarding', element: <OnboardingPage /> },
      { path: '/orgs/:orgId/explore', element: <ExplorePage /> },
      {
        path: '/orgs/:orgId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="general" replace /> },
          { path: 'general', element: <GeneralPage /> },
          { path: 'members', element: <MembersPage /> },
          { path: 'repositories', element: <RepositoriesPage /> },
          { path: 'usage', element: <UsagePage /> },
          { path: 'preferences', element: <PreferencesPage /> },
          { path: 'security', element: <SecurityPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
