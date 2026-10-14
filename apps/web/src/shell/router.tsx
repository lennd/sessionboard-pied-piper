import { createBrowserRouter, Navigate } from 'react-router-dom';
import { Shell } from './guards';
import { FeaturePage } from './features/FeaturePage';
import { FeaturesPage } from './features/FeaturesPage';
import { ExplorePage } from './pages/ExplorePage';
import { ReposPage } from './pages/ReposPage';
import { SolutionPage } from './pages/SolutionPage';
import { PreferencesPage } from './settings/PreferencesPage';
import { RulesPage } from './settings/RulesPage';
import { ToolkitPage } from './settings/ToolkitPage';
import { SettingsLayout } from './settings/SettingsLayout';
import { SolutionsPage } from './settings/SolutionsPage';

export const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <ReposPage /> },
      { path: '/features', element: <FeaturesPage /> },
      { path: '/features/:featureId', element: <FeaturePage /> },
      { path: '/repos/:repoId/explore', element: <ExplorePage /> },
      { path: '/repos/:repoId/solutions/:solutionId', element: <SolutionPage /> },
      {
        path: '/repos/:repoId/settings',
        element: <SettingsLayout />,
        children: [
          { index: true, element: <Navigate to="preferences" replace /> },
          { path: 'preferences', element: <PreferencesPage /> },
          { path: 'rules', element: <RulesPage /> },
          { path: 'toolkit', element: <ToolkitPage /> },
          { path: 'solutions', element: <SolutionsPage /> },
        ],
      },
    ],
  },
  { path: '*', element: <Navigate to="/" replace /> },
]);
