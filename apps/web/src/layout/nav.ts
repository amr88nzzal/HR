import {
  IconAdjustments,
  IconAdjustmentsHorizontal,
  IconArchive,
  IconBeach,
  IconBell,
  IconBellCog,
  IconBuilding,
  IconBuildingBank,
  IconBuildingCommunity,
  IconCalendarCog,
  IconCalendarEvent,
  IconCalendarMonth,
  IconCalendarStar,
  IconCalendarTime,
  IconCalendarWeek,
  IconCash,
  IconCategory,
  IconCertificate,
  IconChartBar,
  IconClipboardCheck,
  IconClipboardList,
  IconClockCheck,
  IconClockEdit,
  IconClockHour4,
  IconClockPlus,
  IconCoin,
  IconCurrencyDollar,
  IconFileImport,
  IconFileSpreadsheet,
  IconFileText,
  IconFiles,
  IconFingerprint,
  IconForms,
  IconHelpCircle,
  IconHistory,
  IconHome,
  IconHourglassLow,
  IconId,
  IconInbox,
  IconKeyboard,
  IconLayoutList,
  IconLink,
  IconListCheck,
  IconListDetails,
  IconMailCog,
  IconMapPin,
  IconPalette,
  IconPlugConnected,
  IconReceipt2,
  IconReportAnalytics,
  IconRoute,
  IconScale,
  IconServerCog,
  IconSettings,
  IconShieldLock,
  IconSitemap,
  IconStairs,
  IconTable,
  IconTags,
  IconTemplate,
  IconTopologyStar3,
  IconUser,
  IconUserShare,
  IconUserShield,
  IconUsers,
} from '@tabler/icons-react';
import type { NavPref } from '@hrms/shared';
import type { ComponentType } from 'react';

type IconType = ComponentType<{ size?: number }>;
export type NavLeaf = {
  /** مفتاح الترجمة تحت nav.* */
  key: string;
  path: string;
  icon: IconType;
  /** الصلاحية المطلوبة لرؤية العنصر */
  permission?: string;
  /** عنصر إعداد (يُضبط مرة ويُنسى): يُعرض تحت قسم «الإعداد» المطوي داخل مجموعته. / A setup item, shown under a folded "Setup" section in its group. */
  setup?: boolean;
};
export type NavGroup = { key: string; icon: IconType; items: NavLeaf[] };

const leaf = (
  key: string,
  path: string,
  icon: IconType,
  permission?: string,
  setup?: boolean,
): NavLeaf => ({
  key,
  path,
  icon,
  ...(permission ? { permission } : {}),
  ...(setup ? { setup } : {}),
});

/**
 * بنية القائمة بحسب المهام: الأساسي في الأعلى، ثم «مساحتي» (كل ما يخص المستخدم نفسه)، ثم وحدات العمل
 * (التشغيل اليومي أولاً ثم قسم «الإعداد» المطوي)، ثم إعداد المنشأة والنظام، والدليل أخيراً.
 * Task-based structure: essentials first, then "My space" (all self-service), then work modules
 * (daily operations first, a folded "Setup" section after), then company setup and system, help last.
 * العنصر بلا صلاحية يظهر لكل مستخدم (تُقيَّد البيانات في الخادم)، والمجموعة الفارغة تختفي.
 */
export const NAV: (NavLeaf | NavGroup)[] = [
  leaf('dashboard', '/', IconHome),
  leaf('approvalsInbox', '/approvals', IconInbox),
  leaf('reportsCenter', '/reports', IconReportAnalytics),
  {
    key: 'mySpace',
    icon: IconUser,
    items: [
      leaf('myPayslips', '/me/payslips', IconReceipt2),
      leaf('myLeave', '/leave', IconBeach, 'leave.request.submit'),
      leaf('leaveCalendar', '/leave/calendar', IconCalendarMonth, 'leave.request.submit'),
      leaf('myAttendance', '/attendance', IconClockCheck, 'leave.request.submit'),
      leaf(
        'attendanceRequests',
        '/attendance/requests',
        IconClockEdit,
        'attendance.correction.submit',
      ),
      leaf('myAdminActions', '/me/admin-actions', IconClipboardList),
      leaf('approvalDelegations', '/approval-delegations', IconUserShare),
      leaf('myNotifications', '/notifications', IconBell),
    ],
  },
  {
    key: 'hrGroup',
    icon: IconUsers,
    items: [
      leaf('employees', '/employees', IconUsers, 'employees.employee.read'),
      leaf('orgChart', '/org/chart', IconTopologyStar3, 'org.department.read'),
      leaf('adminActions', '/admin-actions', IconClipboardCheck, 'admin_actions.action.read'),
      leaf(
        'employeeImport',
        '/employees/import',
        IconFileImport,
        'employees.employee.import',
        true,
      ),
      leaf('adminActionTypes', '/admin-actions/types', IconTags, 'admin_actions.type.read', true),
    ],
  },
  {
    key: 'attendanceGroup',
    icon: IconFingerprint,
    items: [
      leaf('attendanceDaily', '/attendance/daily', IconLayoutList, 'attendance.day.read_all'),
      leaf(
        'attendanceAdjustments',
        '/attendance/adjustments',
        IconClockPlus,
        'attendance.correction.read_all',
      ),
      leaf('attendancePunches', '/attendance/punches', IconKeyboard, 'attendance.punch.create'),
      leaf('attendanceImport', '/attendance/import', IconFileSpreadsheet, 'attendance.import.read'),
      leaf('attendanceShifts', '/attendance/shifts', IconClockHour4, 'attendance.shift.read', true),
      leaf(
        'attendanceSchedules',
        '/attendance/schedules',
        IconCalendarWeek,
        'attendance.schedule.read',
        true,
      ),
      leaf(
        'importProfiles',
        '/attendance/import/profiles',
        IconAdjustmentsHorizontal,
        'attendance.import_profile.read',
        true,
      ),
    ],
  },
  {
    key: 'leaveGroup',
    icon: IconCalendarEvent,
    items: [
      leaf('leaveBalances', '/leave/balances', IconScale, 'leave.balance.read'),
      leaf('leaveReport', '/leave/report', IconChartBar, 'leave.balance.read'),
      leaf('leaveTypes', '/leave/types', IconCalendarCog, 'leave.type.read', true),
      leaf('leavePolicies', '/leave/policies', IconListDetails, 'leave.policy.read', true),
      leaf('leaveAssignments', '/leave/assignments', IconLink, 'leave.policy.read', true),
      leaf('holidays', '/leave/holidays', IconCalendarStar, 'leave.holiday.read', true),
    ],
  },
  {
    key: 'payrollGroup',
    icon: IconCash,
    items: [
      leaf('payrollPeriods', '/payroll/periods', IconCalendarTime, 'payroll.period.read'),
      leaf('payrollShortfall', '/payroll/shortfall', IconHourglassLow, 'payroll.shortfall.read'),
      leaf('payrollLoans', '/payroll/loans', IconCoin, 'payroll.loan.read'),
      leaf('payrollLoansGrid', '/payroll/loans-grid', IconTable, 'payroll.loan.read'),
      leaf('payrollSetup', '/payroll/setup', IconAdjustments, 'payroll.component.read', true),
      leaf(
        'payslipDesign',
        '/payroll/payslip-design',
        IconFileText,
        'payroll.payslip_template.read',
        true,
      ),
    ],
  },
  {
    key: 'documentsGroup',
    icon: IconFiles,
    items: [
      leaf('issuedDocuments', '/letters/issued', IconCertificate, 'letters.document.read'),
      leaf('documents', '/archive/documents', IconArchive, 'archive.document.read'),
      leaf('letterTemplates', '/letters/templates', IconTemplate, 'letters.template.read', true),
      leaf(
        'documentTypes',
        '/archive/document-types',
        IconCategory,
        'archive.document_type.read',
        true,
      ),
    ],
  },
  {
    key: 'orgSetup',
    icon: IconBuildingCommunity,
    items: [
      leaf('branches', '/org/branches', IconBuilding, 'system.branch.read'),
      leaf('departments', '/org/departments', IconSitemap, 'org.department.read'),
      leaf('jobTitles', '/org/job-titles', IconId, 'org.job_title.read'),
      leaf('jobGrades', '/org/job-grades', IconStairs, 'org.job_grade.read'),
      leaf('workLocations', '/org/work-locations', IconMapPin, 'org.work_location.read'),
      leaf('costCenters', '/org/cost-centers', IconBuildingBank, 'org.cost_center.read'),
      leaf('currencies', '/org/currencies', IconCurrencyDollar, 'system.currency.read'),
    ],
  },
  {
    key: 'system',
    icon: IconServerCog,
    items: [
      leaf('users', '/admin/users', IconUserShield, 'identity.user.read'),
      leaf('roles', '/admin/roles', IconShieldLock, 'identity.role.read'),
      leaf('audit', '/admin/audit', IconHistory, 'system.audit.read'),
      leaf('settings', '/admin/settings', IconSettings, 'system.setting.read'),
      leaf('brand', '/admin/brand', IconPalette, 'org.brand.read'),
      leaf('approvalFlows', '/admin/approval-flows', IconRoute, 'approvals.flow.read'),
      leaf('customFields', '/admin/custom-fields', IconForms, 'org.custom_field.read'),
      leaf('channels', '/admin/channels', IconMailCog, 'system.integration.read'),
      leaf(
        'notificationTemplates',
        '/admin/notification-templates',
        IconBellCog,
        'system.notification_template.read',
      ),
      leaf(
        'externalSystems',
        '/admin/external-systems',
        IconPlugConnected,
        'org.external_system.read',
      ),
      leaf('jobs', '/admin/jobs', IconListCheck, 'system.job.read'),
    ],
  },
  leaf('help', '/help', IconHelpCircle),
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

// ───────────────────────── تفضيلات المستخدم ─────────────────────────
type Entry = NavLeaf | NavGroup;
/** مفتاح المدخل في الترتيب: مفتاح المجموعة، أو مفتاح العنصر المنفرد. / Order key: the group key, or a standalone leaf's key. */
export const entryKey = (n: Entry): string => n.key;

/** يرتّب حسب القائمة المحفوظة؛ ما لم يُذكر يبقى بترتيبه الافتراضي بعد المذكور (فتظهر الميزات الجديدة في آخر القائمة). */
const sortBy = <T>(items: T[], key: (x: T) => string, order: readonly string[]): T[] => {
  const rank = new Map(order.map((k, i) => [k, i]));
  return items
    .map((x, i) => ({ x, i }))
    .sort((a, b) => (rank.get(key(a.x)) ?? 1e6 + a.i) - (rank.get(key(b.x)) ?? 1e6 + b.i))
    .map((o) => o.x);
};

/** الترتيب وحده (بلا إخفاء): تستعمله نافذة التخصيص كي ترى المخفي أيضاً. / Order only (no hiding): the customise dialog uses it so hidden items stay visible there. */
export const orderNav = (nav: Entry[], pref: Pick<NavPref, 'groupOrder' | 'itemOrder'>): Entry[] =>
  sortBy(nav, entryKey, pref.groupOrder).map((n) =>
    isGroup(n) ? { ...n, items: sortBy(n.items, (l) => l.path, pref.itemOrder[n.key] ?? []) } : n,
  );

export type NavView = { favorites: NavLeaf[]; nav: Entry[] };

/**
 * يطبّق تفضيلات المستخدم على القائمة المسموحة له: ترتيب، ثم إخفاء، ثم مفضلة.
 * المفضلة تُحلّ من كل العناصر المسموحة (ولو أُخفيت من مكانها الأصلي)، والعنصر الذي لم يعد مسموحاً يسقط تلقائياً.
 * Applies the user's prefs to the permitted nav: order, then hide, then favourites.
 * Favourites resolve from every permitted item (even hidden in place); an item no longer permitted just drops out.
 */
export const applyNavPrefs = (nav: Entry[], pref: NavPref): NavView => {
  const ordered = orderNav(nav, pref);
  const hidden = new Set(pref.hidden);
  const all = new Map(ordered.flatMap((n) => (isGroup(n) ? n.items : [n])).map((l) => [l.path, l]));
  const favorites = pref.favorites.flatMap((p) => {
    const l = all.get(p);
    return l ? [l] : [];
  });
  const visible = ordered.flatMap((n): Entry[] => {
    if (!isGroup(n)) return hidden.has(n.path) ? [] : [n];
    const items = n.items.filter((l) => !hidden.has(l.path));
    return items.length ? [{ ...n, items }] : [];
  });
  return { favorites, nav: visible };
};
