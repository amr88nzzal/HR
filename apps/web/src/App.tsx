import { DirectionProvider, MantineProvider, createTheme } from '@mantine/core';
import { ModalsProvider } from '@mantine/modals';
import { Notifications } from '@mantine/notifications';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { AuthProvider } from './auth/AuthContext';
import { dirOf, type Lang } from './i18n';
import { router } from './routes';

const theme = createTheme({
  fontFamily: '"Noto Sans Arabic Variable", system-ui, -apple-system, "Segoe UI", sans-serif',
  primaryColor: 'teal',
});

export const App = () => {
  const { i18n } = useTranslation();
  const [queryClient] = useState(
    () => new QueryClient({ defaultOptions: { queries: { retry: 1, staleTime: 30_000 } } }),
  );
  return (
    <DirectionProvider initialDirection={dirOf(i18n.language as Lang)} detectDirection={false}>
      <MantineProvider theme={theme} defaultColorScheme="auto">
        <Notifications position="top-center" />
        <ModalsProvider>
          <QueryClientProvider client={queryClient}>
            <AuthProvider>
              <RouterProvider router={router} />
            </AuthProvider>
          </QueryClientProvider>
        </ModalsProvider>
      </MantineProvider>
    </DirectionProvider>
  );
};
