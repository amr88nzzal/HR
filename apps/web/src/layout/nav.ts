import {
  IconBuilding,
  IconBuildingBank,
  IconHome,
  IconHistory,
  IconListCheck,
  IconMailCog,
  IconId,
  IconMapPin,
  IconSettings,
  IconSitemap,
  IconStairs,
  IconUsers,
  IconShieldLock,
  IconCash,
  IconAdjustments,
  IconFileImport,
  IconArchive,
  IconFileDescription,
  IconPlugConnected,
  IconTopologyStar3,
  IconCertificate,
  IconChecklist,
  IconFileText,
  IconUserShare,
  IconRoute,
  IconBeach,
  IconCalendarEvent,
  IconScale,
  IconLink,
  IconCalendarStar,
  IconCalendarMonth,
  IconReportAnalytics,
  IconClockCheck,
  IconClockEdit,
  IconLayoutList,
  IconKeyboard,
  IconFileSpreadsheet,
  IconAdjustmentsHorizontal,
  IconClockHour4,
  IconCalendarWeek,
} from '@tabler/icons-react';
import type { ComponentType } from 'react';

export type NavLeaf = {
  /** مفتاح الترجمة تحت nav.* */
  key: string;
  path: string;
  icon: ComponentType<{ size?: number }>;
  /** الصلاحية المطلوبة لرؤية العنصر */
  permission?: string;
};
export type NavGroup = { key: string; items: NavLeaf[] };

/** القائمة تُبنى من الصلاحيات: العنصر بلا صلاحية يختفي، والمجموعة الفارغة تختفي. */
export const NAV: (NavLeaf | NavGroup)[] = [
  { key: 'dashboard', path: '/', icon: IconHome },
  {
    key: 'hrGroup',
    items: [
      {
        key: 'employees',
        path: '/employees',
        icon: IconUsers,
        permission: 'employees.employee.read',
      },
      {
        key: 'employeeImport',
        path: '/employees/import',
        icon: IconFileImport,
        permission: 'employees.employee.import',
      },
      {
        key: 'orgChart',
        path: '/org/chart',
        icon: IconTopologyStar3,
        permission: 'org.department.read',
      },
    ],
  },
  {
    key: 'leaveGroup',
    items: [
      {
        key: 'myLeave',
        path: '/leave',
        icon: IconBeach,
        permission: 'leave.request.submit',
      },
      {
        key: 'leaveCalendar',
        path: '/leave/calendar',
        icon: IconCalendarMonth,
        permission: 'leave.request.submit',
      },
      {
        key: 'leaveBalances',
        path: '/leave/balances',
        icon: IconScale,
        permission: 'leave.balance.read',
      },
      {
        key: 'leaveReport',
        path: '/leave/report',
        icon: IconReportAnalytics,
        permission: 'leave.balance.read',
      },
      {
        key: 'leaveTypes',
        path: '/leave/types',
        icon: IconCalendarEvent,
        permission: 'leave.type.read',
      },
      {
        key: 'leavePolicies',
        path: '/leave/policies',
        icon: IconListCheck,
        permission: 'leave.policy.read',
      },
      {
        key: 'leaveAssignments',
        path: '/leave/assignments',
        icon: IconLink,
        permission: 'leave.policy.read',
      },
      {
        key: 'holidays',
        path: '/leave/holidays',
        icon: IconCalendarStar,
        permission: 'leave.holiday.read',
      },
    ],
  },
  {
    key: 'attendanceGroup',
    items: [
      {
        key: 'myAttendance',
        path: '/attendance',
        icon: IconClockCheck,
        permission: 'leave.request.submit',
      },
      {
        key: 'attendanceDaily',
        path: '/attendance/daily',
        icon: IconLayoutList,
        permission: 'attendance.day.read_all',
      },
      {
        key: 'attendanceRequests',
        path: '/attendance/requests',
        icon: IconClockEdit,
        permission: 'attendance.correction.submit',
      },
      {
        key: 'attendanceAdjustments',
        path: '/attendance/adjustments',
        icon: IconChecklist,
        permission: 'attendance.correction.read_all',
      },
      {
        key: 'attendancePunches',
        path: '/attendance/punches',
        icon: IconKeyboard,
        permission: 'attendance.punch.create',
      },
      {
        key: 'attendanceShifts',
        path: '/attendance/shifts',
        icon: IconClockHour4,
        permission: 'attendance.shift.read',
      },
      {
        key: 'attendanceSchedules',
        path: '/attendance/schedules',
        icon: IconCalendarWeek,
        permission: 'attendance.schedule.read',
      },
      {
        key: 'attendanceImport',
        path: '/attendance/import',
        icon: IconFileSpreadsheet,
        permission: 'attendance.import.read',
      },
      {
        key: 'importProfiles',
        path: '/attendance/import/profiles',
        icon: IconAdjustmentsHorizontal,
        permission: 'attendance.import_profile.read',
      },
    ],
  },
  {
    key: 'lettersGroup',
    items: [
      {
        key: 'issuedDocuments',
        path: '/letters/issued',
        icon: IconCertificate,
        permission: 'letters.document.read',
      },
      {
        key: 'letterTemplates',
        path: '/letters/templates',
        icon: IconFileText,
        permission: 'letters.template.read',
      },
    ],
  },
  {
    key: 'payrollGroup',
    items: [
      {
        key: 'payrollSetup',
        path: '/payroll/setup',
        icon: IconCash,
        permission: 'payroll.component.read',
      },
      {
        key: 'payrollPeriods',
        path: '/payroll/periods',
        icon: IconCash,
        permission: 'payroll.period.read',
      },
      {
        key: 'payrollLoans',
        path: '/payroll/loans',
        icon: IconCash,
        permission: 'payroll.loan.read',
      },
    ],
  },
  {
    key: 'approvalsGroup',
    items: [
      { key: 'approvalsInbox', path: '/approvals', icon: IconChecklist },
      { key: 'approvalDelegations', path: '/approval-delegations', icon: IconUserShare },
      {
        key: 'approvalFlows',
        path: '/admin/approval-flows',
        icon: IconRoute,
        permission: 'approvals.flow.read',
      },
    ],
  },
  {
    key: 'archiveGroup',
    items: [
      {
        key: 'documents',
        path: '/archive/documents',
        icon: IconArchive,
        permission: 'archive.document.read',
      },
      {
        key: 'documentTypes',
        path: '/archive/document-types',
        icon: IconFileDescription,
        permission: 'archive.document_type.read',
      },
    ],
  },
  {
    key: 'org',
    items: [
      {
        key: 'branches',
        path: '/org/branches',
        icon: IconBuilding,
        permission: 'system.branch.read',
      },
      {
        key: 'departments',
        path: '/org/departments',
        icon: IconSitemap,
        permission: 'org.department.read',
      },
      { key: 'jobTitles', path: '/org/job-titles', icon: IconId, permission: 'org.job_title.read' },
      {
        key: 'jobGrades',
        path: '/org/job-grades',
        icon: IconStairs,
        permission: 'org.job_grade.read',
      },
      {
        key: 'workLocations',
        path: '/org/work-locations',
        icon: IconMapPin,
        permission: 'org.work_location.read',
      },
      {
        key: 'costCenters',
        path: '/org/cost-centers',
        icon: IconBuildingBank,
        permission: 'org.cost_center.read',
      },
      {
        key: 'currencies',
        path: '/org/currencies',
        icon: IconCash,
        permission: 'system.currency.read',
      },
    ],
  },
  {
    key: 'admin',
    items: [
      { key: 'users', path: '/admin/users', icon: IconUsers, permission: 'identity.user.read' },
      {
        key: 'roles',
        path: '/admin/roles',
        icon: IconShieldLock,
        permission: 'identity.role.read',
      },
      {
        key: 'settings',
        path: '/admin/settings',
        icon: IconSettings,
        permission: 'system.setting.read',
      },
      {
        key: 'externalSystems',
        path: '/admin/external-systems',
        icon: IconPlugConnected,
        permission: 'org.external_system.read',
      },
      {
        key: 'customFields',
        path: '/admin/custom-fields',
        icon: IconAdjustments,
        permission: 'org.custom_field.read',
      },
      { key: 'audit', path: '/admin/audit', icon: IconHistory, permission: 'system.audit.read' },
      { key: 'jobs', path: '/admin/jobs', icon: IconListCheck, permission: 'system.job.read' },
      {
        key: 'channels',
        path: '/admin/channels',
        icon: IconMailCog,
        permission: 'system.integration.read',
      },
      {
        key: 'notificationTemplates',
        path: '/admin/notification-templates',
        icon: IconMailCog,
        permission: 'system.notification_template.read',
      },
    ],
  },
];

export const isGroup = (n: NavLeaf | NavGroup): n is NavGroup => 'items' in n;

export const visibleNav = (permissions: readonly string[]): (NavLeaf | NavGroup)[] => {
  type Entry = NavLeaf | NavGroup;
  const ok = (l: NavLeaf) => !l.permission || permissions.includes(l.permission);
  return NAV.flatMap((n): Entry[] => {
    if (!isGroup(n)) return ok(n) ? [n] : [];
    const items = n.items.filter(ok);
    return items.length ? [{ ...n, items }] : [];
  });
};

/** الصلاحية المطلوبة لمسار معيّن (للحماية على مستوى المسار) */
export const permissionForPath = (path: string): string | undefined => {
  for (const n of NAV) {
    const leaf = isGroup(n)
      ? n.items.find((i) => i.path === path)
      : n.path === path
        ? n
        : undefined;
    if (leaf) return leaf.permission;
  }
  return undefined;
};
