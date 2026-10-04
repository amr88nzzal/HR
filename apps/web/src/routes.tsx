import { Center, Loader } from '@mantine/core';
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
  useRouterState,
} from '@tanstack/react-router';
import { useAuth } from './auth/AuthContext';
import { AppLayout } from './layout/AppLayout';
import { isGroup, NAV } from './layout/nav';
import { ChangePasswordPage } from './pages/ChangePasswordPage';
import { LoginPage } from './pages/LoginPage';
import { ComingSoonPage, DashboardPage, ForbiddenPage, NotFoundPage } from './pages/SimplePages';

const Spinner = () => (
  <Center mih="100vh">
    <Loader />
  </Center>
);

const rootRoute = createRootRoute({ component: Outlet, notFoundComponent: NotFoundPage });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/login',
  component: function Login() {
    const { status } = useAuth();
    if (status === 'loading') return <Spinner />;
    if (status === 'authenticated') return <Navigate to="/" />;
    return <LoginPage />;
  },
});

/** حارس الجلسة + الهيكل العام. المحتوى المحمي لا يُرسم قبل التحقق. */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'auth',
  component: function AuthLayout() {
    const { status, me } = useAuth();
    const pathname = useRouterState({ select: (s) => s.location.pathname });
    if (status === 'loading') return <Spinner />;
    if (status === 'anonymous' || !me) return <Navigate to="/login" />;
    if (me.mustChangePassword && pathname !== '/change-password')
      return <Navigate to="/change-password" />;
    return (
      <AppLayout>
        <Outlet />
      </AppLayout>
    );
  },
});

const indexRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/',
  component: DashboardPage,
});
const passwordRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/change-password',
  component: ChangePasswordPage,
});

/** شاشات 1d تُستبدل بها لاحقاً؛ الحماية بالصلاحية فعّالة من الآن (403 بدل الشاشة). */
const sectionRoutes = NAV.flatMap((n) => (isGroup(n) ? n.items : [])).map((leaf) =>
  createRoute({
    getParentRoute: () => authRoute,
    path: leaf.path,
    component: function Section() {
      const { can } = useAuth();
      return can(leaf.permission) ? <ComingSoonPage titleKey={leaf.key} /> : <ForbiddenPage />;
    },
  }),
);

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([indexRoute, passwordRoute, ...sectionRoutes]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
