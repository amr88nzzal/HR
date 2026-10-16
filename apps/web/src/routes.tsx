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
import { AcceptInvitePage } from './pages/AcceptInvitePage';
import { VerifyPage } from './pages/VerifyPage';
import { LoginPage } from './pages/LoginPage';
import { JobsPage } from './features/admin/JobsPage';
import { ChannelsPage } from './features/admin/ChannelsPage';
import { NotificationTemplatesPage } from './features/admin/NotificationTemplatesPage';
import { ApprovalFlowsPage } from './features/admin/ApprovalFlowsPage';
import { ApprovalsPage } from './features/approvals/ApprovalsPage';
import { ApprovalDetailPage } from './features/approvals/ApprovalDetailPage';
import { DelegationsPage } from './features/approvals/DelegationsPage';
import { MyLeavePage } from './features/leave/MyLeavePage';
import { BalancesAdminPage } from './features/leave/BalancesAdminPage';
import { TeamCalendarPage } from './features/leave/TeamCalendarPage';
import { BalancesReportPage } from './features/leave/BalancesReportPage';
import { AssignmentsPage } from './features/leave/AssignmentsPage';
import { MyAttendancePage } from './features/attendance/MyAttendancePage';
import { DailyBoardPage } from './features/attendance/DailyBoardPage';
import { PunchEntryPage } from './features/attendance/PunchEntryPage';
import { AdjustmentsPage } from './features/attendance/AdjustmentsPage';
import { TemplatesPage } from './features/letters/TemplatesPage';
import { IssuedPage } from './features/letters/IssuedPage';
import { LoansPanel } from './features/payroll/LoansPanel';
import { BrandPage } from './features/brand/BrandPage';
import { PeriodPage } from './features/payroll/PeriodPage';
import { PeriodsPage } from './features/payroll/PeriodsPage';
import { SetupPage as PayrollSetupPage } from './features/payroll/SetupPage';
import { ShiftsPage } from './features/attendance/ShiftsPage';
import { SchedulesPage } from './features/attendance/SchedulesPage';
import { ImportPage } from './features/attendance/ImportPage';
import { ImportProfilesPage } from './features/attendance/ImportProfilesPage';
import { NotificationsPage } from './features/notifications/NotificationsPage';
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

/** التحقق العام من وثيقة (QR): خارج الجلسة تماماً */
const verifyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/verify/$token',
  component: VerifyPage,
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
  '/admin/brand': () => <BrandPage />,
  '/admin/audit': () => <AuditPage />,
  '/admin/jobs': () => <JobsPage />,
  '/admin/channels': () => <ChannelsPage />,
  '/admin/notification-templates': () => <NotificationTemplatesPage />,
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
  '/attendance/punches': () => <PunchEntryPage />,
  '/attendance/shifts': () => <ShiftsPage />,
  '/attendance/schedules': () => <SchedulesPage />,
  '/attendance/import': () => <ImportPage />,
  '/attendance/import/profiles': () => <ImportProfilesPage />,
  '/approvals': () => <ApprovalsPage />,
  '/approval-delegations': () => <DelegationsPage />,
  '/admin/approval-flows': () => <ApprovalFlowsPage />,
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

/** إشعاراتي: صفحة لكل مستخدم بلا صلاحية (تُفتح من الجرس) */
const notificationsRoute = createRoute({
  getParentRoute: () => authRoute,
  path: '/notifications',
  component: NotificationsPage,
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
  authRoute.addChildren([
    indexRoute,
    passwordRoute,
    ...sectionRoutes,
    employeeRoute,
    notificationsRoute,
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
