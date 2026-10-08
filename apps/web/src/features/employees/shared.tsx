import { Badge } from '@mantine/core';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { useList, type Row } from '../../api/hooks';
import { useAuth } from '../../auth/AuthContext';
import type { Option } from '../../components/DynamicForm';
import { localName } from '../../lib/names';

/** خيارات قائمة من تعداد مترجم: hr.enums.<group>.<value> */
export const enumOptions = (t: TFunction, group: string, values: readonly string[]): Option[] =>
  values.map((v) => ({ value: v, label: t(`hr.enums.${group}.${v}`) }));

export const enumLabel = (t: TFunction, group: string, value: unknown): string =>
  typeof value === 'string' && value
    ? t(`hr.enums.${group}.${value}`, { defaultValue: value })
    : '—';

const STATUS_COLOR: Record<string, string> = {
  active: 'teal',
  suspended: 'yellow',
  terminated: 'gray',
};
export const StatusBadge = ({ status }: { status: unknown }) => {
  const { t } = useTranslation();
  const s = typeof status === 'string' ? status : '';
  return (
    <Badge color={STATUS_COLOR[s] ?? 'gray'} variant="light">
      {enumLabel(t, 'empStatus', s)}
    </Badge>
  );
};

/** جدول مرجعي كامل (حتى 200 سجل) مع دالة تحويل المعرّف إلى اسم محلي. يُجلب فقط إن توفرت الصلاحية. */
export const useLookup = (path: string, permission: string) => {
  const { can } = useAuth();
  const { i18n } = useTranslation();
  const q = useList(path, { pageSize: 200 }, can(permission));
  const rows: Row[] = q.data?.data ?? [];
  return {
    rows,
    options: rows.map((r): Option => ({ value: r.id, label: localName(r, i18n.language) })),
    name: (id: unknown): string => {
      if (typeof id !== 'string') return '—';
      const hit = rows.find((r) => r.id === id);
      return hit ? localName(hit, i18n.language) : '—';
    },
  };
};

export const useOrgLookups = () => ({
  branches: useLookup('/branches', 'system.branch.read'),
  departments: useLookup('/departments', 'org.department.read'),
  jobTitles: useLookup('/job-titles', 'org.job_title.read'),
});

export const str = (v: unknown): string => (typeof v === 'string' ? v : '');
