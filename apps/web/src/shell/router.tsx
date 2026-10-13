import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Shell } from './guards';
import { ExplorePage } from './pages/ExplorePage';
import { ReposPage } from './pages/ReposPage';
import { SolutionPage } from './pages/SolutionPage';
import { PreferencesPage } from './settings/PreferencesPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { SolutionsPage } from './settings/SolutionsPage';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <ReposPage /> },
      { path: '/repos/:repoId/explore', element: <ExplorePage /> },
      { path: '/repos/:repoId/solutions/:solutionId', element: <SolutionPage /> },
      {
        path: '/repos/:repoId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="preferences" replace /> },
          { path: 'preferences', element: <PreferencesPage /> },
          { path: 'solutions', element: <SolutionsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
