import { Center, Loader } from '@mantine/core';
import { lazy, Suspense, type ReactElement } from 'react';
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
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { VerifyPage } from './pages/VerifyPage';
import { LoginPage } from './pages/LoginPage';
import { SetupPage as PayrollSetupPage } from './features/payroll/SetupPage';
import { ComingSoonPage, ForbiddenPage, NotFoundPage } from './pages/SimplePages';

// الشاشات تُحمَّل عند أول زيارة (تقسيم الحزمة) / screens load on first visit (code-splitting)
const PlatformPage = lazy(() =>
  import('./features/platform/PlatformPage').then((m) => ({ default: m.PlatformPage })),
);
const HelpPage = lazy(() =>
  import('./features/help/HelpPage').then((m) => ({ default: m.HelpPage })),
);
const JobsPage = lazy(() =>
  import('./features/admin/JobsPage').then((m) => ({ default: m.JobsPage })),
);
const ChannelsPage = lazy(() =>
  import('./features/admin/ChannelsPage').then((m) => ({ default: m.ChannelsPage })),
);
const NotificationTemplatesPage = lazy(() =>
  import('./features/admin/NotificationTemplatesPage').then((m) => ({
    default: m.NotificationTemplatesPage,
  })),
);
const ApprovalFlowsPage = lazy(() =>
  import('./features/admin/ApprovalFlowsPage').then((m) => ({ default: m.ApprovalFlowsPage })),
);
const ApprovalsPage = lazy(() =>
  import('./features/approvals/ApprovalsPage').then((m) => ({ default: m.ApprovalsPage })),
);
const ApprovalDetailPage = lazy(() =>
  import('./features/approvals/ApprovalDetailPage').then((m) => ({
    default: m.ApprovalDetailPage,
  })),
);
const DelegationsPage = lazy(() =>
  import('./features/approvals/DelegationsPage').then((m) => ({ default: m.DelegationsPage })),
);
const ReportsPage = lazy(() =>
  import('./features/reports/ReportsPage').then((m) => ({ default: m.ReportsPage })),
);
const AdminActionsPage = lazy(() =>
  import('./features/adminActions/AdminActionsPage').then((m) => ({ default: m.AdminActionsPage })),
);
const AdminActionTypesPage = lazy(() =>
  import('./features/adminActions/AdminActionTypesPage').then((m) => ({
    default: m.AdminActionTypesPage,
  })),
);
const MyAdminActionsPage = lazy(() =>
  import('./features/adminActions/MyAdminActionsPage').then((m) => ({
    default: m.MyAdminActionsPage,
  })),
);
const MyPayslipsPage = lazy(() =>
  import('./features/payroll/MyPayslipsPage').then((m) => ({ default: m.MyPayslipsPage })),
);
const MyLeavePage = lazy(() =>
  import('./features/leave/MyLeavePage').then((m) => ({ default: m.MyLeavePage })),
);
const BalancesAdminPage = lazy(() =>
  import('./features/leave/BalancesAdminPage').then((m) => ({ default: m.BalancesAdminPage })),
);
const TeamCalendarPage = lazy(() =>
  import('./features/leave/TeamCalendarPage').then((m) => ({ default: m.TeamCalendarPage })),
);
const BalancesReportPage = lazy(() =>
  import('./features/leave/BalancesReportPage').then((m) => ({ default: m.BalancesReportPage })),
);
const AssignmentsPage = lazy(() =>
  import('./features/leave/AssignmentsPage').then((m) => ({ default: m.AssignmentsPage })),
);
const MyAttendancePage = lazy(() =>
  import('./features/attendance/MyAttendancePage').then((m) => ({ default: m.MyAttendancePage })),
);
const DailyBoardPage = lazy(() =>
  import('./features/attendance/DailyBoardPage').then((m) => ({ default: m.DailyBoardPage })),
);
const PunchEntryPage = lazy(() =>
  import('./features/attendance/PunchEntryPage').then((m) => ({ default: m.PunchEntryPage })),
);
const AdjustmentsPage = lazy(() =>
  import('./features/attendance/AdjustmentsPage').then((m) => ({ default: m.AdjustmentsPage })),
);
const TemplatesPage = lazy(() =>
  import('./features/letters/TemplatesPage').then((m) => ({ default: m.TemplatesPage })),
);
const IssuedPage = lazy(() =>
  import('./features/letters/IssuedPage').then((m) => ({ default: m.IssuedPage })),
);
const LoansPanel = lazy(() =>
  import('./features/payroll/LoansPanel').then((m) => ({ default: m.LoansPanel })),
);
const ShortfallPage = lazy(() =>
  import('./features/payroll/ShortfallPage').then((m) => ({ default: m.ShortfallPage })),
);
const BrandPage = lazy(() =>
  import('./features/brand/BrandPage').then((m) => ({ default: m.BrandPage })),
);
const PeriodPage = lazy(() =>
  import('./features/payroll/PeriodPage').then((m) => ({ default: m.PeriodPage })),
);
const PeriodsPage = lazy(() =>
  import('./features/payroll/PeriodsPage').then((m) => ({ default: m.PeriodsPage })),
);
const ShiftsPage = lazy(() =>
  import('./features/attendance/ShiftsPage').then((m) => ({ default: m.ShiftsPage })),
);
const SchedulesPage = lazy(() =>
  import('./features/attendance/SchedulesPage').then((m) => ({ default: m.SchedulesPage })),
);
const ImportPage = lazy(() =>
  import('./features/attendance/ImportPage').then((m) => ({ default: m.ImportPage })),
);
const ImportProfilesPage = lazy(() =>
  import('./features/attendance/ImportProfilesPage').then((m) => ({
    default: m.ImportProfilesPage,
  })),
);
const NotificationsPage = lazy(() =>
  import('./features/notifications/NotificationsPage').then((m) => ({
    default: m.NotificationsPage,
  })),
);
const AuditPage = lazy(() =>
  import('./features/AuditPage').then((m) => ({ default: m.AuditPage })),
);
const CustomFieldsPage = lazy(() =>
  import('./features/admin/CustomFieldsPage').then((m) => ({ default: m.CustomFieldsPage })),
);
const ExternalSystemsPage = lazy(() =>
  import('./features/admin/ExternalSystemsPage').then((m) => ({ default: m.ExternalSystemsPage })),
);
const OrgChartPage = lazy(() =>
  import('./features/admin/OrgChartPage').then((m) => ({ default: m.OrgChartPage })),
);
const DocumentsPage = lazy(() =>
  import('./features/archive/DocumentsPage').then((m) => ({ default: m.DocumentsPage })),
);
const DocumentTypesPage = lazy(() =>
  import('./features/archive/DocumentTypesPage').then((m) => ({ default: m.DocumentTypesPage })),
);
const EmployeeImportPage = lazy(() =>
  import('./features/employees/EmployeeImportPage').then((m) => ({
    default: m.EmployeeImportPage,
  })),
);
const EmployeePage = lazy(() =>
  import('./features/employees/EmployeePage').then((m) => ({ default: m.EmployeePage })),
);
const EmployeesPage = lazy(() =>
  import('./features/employees/EmployeesPage').then((m) => ({ default: m.EmployeesPage })),
);
const ResourcePage = lazy(() =>
  import('./features/ResourcePage').then((m) => ({ default: m.ResourcePage })),
);
const RolesPage = lazy(() =>
  import('./features/RolesPage').then((m) => ({ default: m.RolesPage })),
);
const SettingsPage = lazy(() =>
  import('./features/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);
const UsersPage = lazy(() =>
  import('./features/UsersPage').then((m) => ({ default: m.UsersPage })),
);
const DashboardPage = lazy(() =>
  import('./pages/DashboardPage').then((m) => ({ default: m.DashboardPage })),
);

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

/** التحقق العام من وثيقة (QR): خارج الجلسة تماماً */
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify/$token',
  component: VerifyPage,
});

/** إدارة الشركات (مدير المنصة): خارج جلسة المستخدمين، بمفتاح مستقل */
const platformRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/platform',
  component: function Platform() {
    return (
      <Suspense fallback={<Spinner />}>
        <PlatformPage />
      </Suspense>
    );
  },
});

/** تفعيل الحساب من رابط الدعوة: خارج الجلسة */
const acceptInviteRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/accept-invite',
  component: AcceptInvitePage,
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
        <Suspense
          fallback={
            <Center mih={240}>
              <Loader />
            </Center>
          }
        >
          <Outlet />
        </Suspense>
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
  '/admin/brand': () => <BrandPage />,
  '/admin/audit': () => <AuditPage />,
  '/admin/jobs': () => <JobsPage />,
  '/admin/channels': () => <ChannelsPage />,
  '/admin/notification-templates': () => <NotificationTemplatesPage />,
  '/me/payslips': () => <MyPayslipsPage />,
  '/help': () => <HelpPage />,
  '/me/admin-actions': () => <MyAdminActionsPage />,
  '/notifications': () => <NotificationsPage />,
  '/admin-actions': () => <AdminActionsPage />,
  '/admin-actions/types': () => <AdminActionTypesPage />,
  '/reports': () => <ReportsPage />,
  '/leave': () => <MyLeavePage />,
  '/leave/calendar': () => <TeamCalendarPage />,
  '/leave/report': () => <BalancesReportPage />,
  '/leave/balances': () => <BalancesAdminPage />,
  '/leave/types': () => <ResourcePage resourceKey="leave-types" />,
  '/leave/policies': () => <ResourcePage resourceKey="leave-policies" />,
  '/leave/assignments': () => <AssignmentsPage />,
  '/leave/holidays': () => <ResourcePage resourceKey="holidays" />,
  '/attendance': () => <MyAttendancePage />,
  '/attendance/daily': () => <DailyBoardPage />,
  '/attendance/requests': () => <AdjustmentsPage all={false} />,
  '/attendance/adjustments': () => <AdjustmentsPage all />,
  '/letters/templates': () => <TemplatesPage />,
  '/letters/issued': () => <IssuedPage />,
  '/payroll/setup': () => <PayrollSetupPage />,
  '/payroll/periods': () => <PeriodsPage />,
  '/payroll/loans': () => <LoansPanel />,
  '/payroll/shortfall': () => <ShortfallPage />,
  '/attendance/punches': () => <PunchEntryPage />,
  '/attendance/shifts': () => <ShiftsPage />,
  '/attendance/schedules': () => <SchedulesPage />,
  '/attendance/import': () => <ImportPage />,
  '/attendance/import/profiles': () => <ImportProfilesPage />,
  '/approvals': () => <ApprovalsPage />,
  '/approval-delegations': () => <DelegationsPage />,
  '/admin/approval-flows': () => <ApprovalFlowsPage />,
};

/** عناصر القائمة المستقلة (بلا مجموعة) كقسائم راتبي والتقارير تحتاج مساراً أيضاً؛ الجذر `/` له indexRoute. */
const sectionRoutes = NAV.flatMap((n) => (isGroup(n) ? n.items : n.path === '/' ? [] : [n])).map(
  (leaf) =>
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

/** تفاصيل طلب موافقة: متاحة لكل مستخدم مسجل (الخادم يقرر الرؤية) */
const approvalDetailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/approvals/$approvalId',
  component: ApprovalDetailPage,
});

/** تفاصيل دورة رواتب: بصلاحية عرض الدورات */
const payrollPeriodRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/payroll/periods/$periodId',
  component: function PayrollPeriod() {
    const { can } = useAuth();
    if (!can('payroll.period.read')) return <ForbiddenPage />;
    return <PeriodPage />;
  },
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  verifyRoute,
  acceptInviteRoute,
  platformRoute,
  authRoute.addChildren([
    indexRoute,
    passwordRoute,
    ...sectionRoutes,
    employeeRoute,
    approvalDetailRoute,
    payrollPeriodRoute,
  ]),
]);

export const router = createRouter({ routeTree, defaultPreload: 'intent' });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}
