import { Center, Loader } from '@mantine/core';
import type { ReactElement } from 'react';
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
import { JobsPage } from './features/admin/JobsPage';
import { AuditPage } from './features/AuditPage';
import { CustomFieldsPage } from './features/admin/CustomFieldsPage';
import { ExternalSystemsPage } from './features/admin/ExternalSystemsPage';
import { OrgChartPage } from './features/admin/OrgChartPage';
import { DocumentsPage } from './features/archive/DocumentsPage';
import { DocumentTypesPage } from './features/archive/DocumentTypesPage';
import { EmployeeImportPage } from './features/employees/EmployeeImportPage';
import { EmployeePage } from './features/employees/EmployeePage';
import { EmployeesPage } from './features/employees/EmployeesPage';
import { ResourcePage } from './features/ResourcePage';
import { RolesPage } from './features/RolesPage';
import { SettingsPage } from './features/SettingsPage';
import { UsersPage } from './features/UsersPage';
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

/** كل مسار قائمة يرتبط بشاشته؛ الحماية بالصلاحية على المسار نفسه (403 بدل الشاشة). */
const screens: Record<string, () => ReactElement> = {
  '/org/branches': () => <ResourcePage resourceKey="branches" />,
  '/org/departments': () => <ResourcePage resourceKey="departments" />,
  '/org/job-titles': () => <ResourcePage resourceKey="job-titles" />,
  '/org/job-grades': () => <ResourcePage resourceKey="job-grades" />,
  '/org/work-locations': () => <ResourcePage resourceKey="work-locations" />,
  '/org/cost-centers': () => <ResourcePage resourceKey="cost-centers" />,
  '/org/currencies': () => <ResourcePage resourceKey="currencies" />,
  '/employees': () => <EmployeesPage />,
  '/employees/import': () => <EmployeeImportPage />,
  '/org/chart': () => <OrgChartPage />,
  '/archive/documents': () => <DocumentsPage />,
  '/archive/document-types': () => <DocumentTypesPage />,
  '/admin/external-systems': () => <ExternalSystemsPage />,
  '/admin/custom-fields': () => <CustomFieldsPage />,
  '/admin/users': () => <UsersPage />,
  '/admin/roles': () => <RolesPage />,
  '/admin/settings': () => <SettingsPage />,
  '/admin/audit': () => <AuditPage />,
  '/admin/jobs': () => <JobsPage />,
};

const sectionRoutes = NAV.flatMap((n) => (isGroup(n) ? n.items : [])).map((leaf) =>
  createRoute({
    getParentRoute: () => authRoute,
    path: leaf.path,
    component: function Section() {
      const { can } = useAuth();
      const Screen = screens[leaf.path];
      if (!can(leaf.permission)) return <ForbiddenPage />;
      return Screen ? <Screen /> : <ComingSoonPage titleKey={leaf.key} />;
    },
  }),
);

/** بطاقة الموظف: مسار ديناميكي بالصلاحية نفسها لقائمة الموظفين */
const employeeRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/employees/$employeeId',
  component: function EmployeeCard() {
    const { can } = useAuth();
    if (!can('employees.employee.read')) return <ForbiddenPage />;
    return <EmployeePage />;
  },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  authRoute.addChildren([indexRoute, passwordRoute, ...sectionRoutes, employeeRoute]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
