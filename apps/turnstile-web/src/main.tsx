import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, Outlet, RouterProvider } from 'react-router';
import { NavigationGuard } from '@/components/navigation';
import './index.css';
import App, { Workspace } from './App.tsx';

const root = document.getElementById('root');
if (!root) throw new Error('Missing application root');

const router = createBrowserRouter([
  {
    element: (
      <NavigationGuard>
        <Outlet />
      </NavigationGuard>
    ),
    children: [
      ...[
        'invitations/join',
        'sign-in',
        'forgot-password',
        'reset-password',
        'unauthorized',
        'session-expired',
        ...(import.meta.env.DEV ? ['design-system'] : []),
      ].map((path) => ({ path, element: <App /> })),
      // All workspace destinations share this session boundary and persistent layout.
      { path: '*', element: <Workspace /> },
    ],
  },
]);

createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} useTransitions={false} />
  </StrictMode>,
);
