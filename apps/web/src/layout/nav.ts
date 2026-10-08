import {
  IconBuilding,
  IconBuildingBank,
  IconHome,
  IconHistory,
  IconId,
  IconMapPin,
  IconSettings,
  IconSitemap,
  IconStairs,
  IconUsers,
  IconShieldLock,
  IconCash,
  IconAdjustments,
  IconArchive,
  IconFileDescription,
  IconPlugConnected,
  IconTopologyStar3,
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
        key: 'orgChart',
        path: '/org/chart',
        icon: IconTopologyStar3,
        permission: 'org.department.read',
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
