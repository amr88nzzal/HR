import type { z } from 'zod';
import {
  branchInput,
  costCenterInput,
  currencyInput,
  departmentInput,
  jobGradeInput,
  jobTitleInput,
  workLocationInput,
} from '@hrms/shared';
import type { TFunction } from 'i18next';
import { ActiveBadge, type Column } from '../components/DataTable';
import type { FieldDef } from '../components/DynamicForm';
import { localName } from '../lib/names';

export type ResourceDef = {
  /** مفتاح العنوان تحت nav.* */
  navKey: string;
  /** مسار الـ API */
  path: string;
  /** بادئة الصلاحية، مثل system.branch */
  perm: string;
  schema: z.ZodType;
  fields: FieldDef[];
  defaults: Record<string, unknown>;
  /** حقل ← مسار مورد تُحمَّل منه الخيارات (المعرّف ← الاسم المحلي) */
  remote?: Record<string, string>;
  /** حقل يشير إلى المورد نفسه (أب) فيستثنى السجل الحالي من خياراته */
  selfRef?: string;
  columns: (
    t: TFunction,
    lang: string,
    lookup: (path: string, id: unknown) => string,
  ) => Column<Record<string, unknown> & { id: string }>[];
};

type Row = Record<string, unknown> & { id: string };
const str = (v: unknown) => (typeof v === 'string' ? v : '');
const text = (key: string, header: string, extra: Partial<Column<Row>> = {}): Column<Row> => ({
  key,
  header,
  render: (r) => str(r[key]) || '—',
  exportValue: (r) => str(r[key]),
  ...extra,
});
const active = (header: string): Column<Row> => ({
  key: 'isActive',
  header,
  render: (r) => <ActiveBadge active={r['isActive'] === true} />,
  exportValue: (r) => r['isActive'] === true,
});
const codeCol = (t: TFunction) => text('code', t('fields.code'), { ltr: true });
const nameCol = (t: TFunction, lang: string): Column<Row> => ({
  key: 'name',
  header: t('fields.nameAr'),
  render: (r) => localName(r, lang),
  exportValue: (r) => localName(r, lang),
});
const base = (): FieldDef[] => [
  { name: 'code', kind: 'text', required: true, ltr: true, lockOnEdit: true },
  { name: 'nameAr', kind: 'text', required: true },
  { name: 'nameEn', kind: 'text' },
];

export const RESOURCES: Record<string, ResourceDef> = {
  branches: {
    navKey: 'branches',
    path: '/branches',
    perm: 'system.branch',
    schema: branchInput,
    fields: [
      ...base(),
      { name: 'country', kind: 'text' },
      { name: 'city', kind: 'text' },
      { name: 'address', kind: 'text' },
      { name: 'phone', kind: 'text', ltr: true },
      { name: 'timezone', kind: 'text', ltr: true },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: { isActive: true },
    columns: (t, lang) => [
      codeCol(t),
      nameCol(t, lang),
      text('city', t('fields.city')),
      text('phone', t('fields.phone'), { ltr: true }),
      active(t('table.active')),
    ],
  },
  departments: {
    navKey: 'departments',
    path: '/departments',
    perm: 'org.department',
    schema: departmentInput,
    fields: [
      ...base(),
      { name: 'parentId', kind: 'select' },
      { name: 'branchIds', kind: 'multiselect', required: true },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: { isActive: true, branchIds: [] },
    remote: { branchIds: '/branches' },
    selfRef: 'parentId',
    columns: (t, lang, lookup) => [
      codeCol(t),
      nameCol(t, lang),
      {
        key: 'parent',
        header: t('fields.parentId'),
        render: (r) => lookup('/departments', r['parentId']),
        exportValue: (r) => lookup('/departments', r['parentId']),
      },
      {
        key: 'branches',
        header: t('fields.branchIds'),
        render: (r) =>
          ((r['branchIds'] as string[]) ?? []).map((b) => lookup('/branches', b)).join('، '),
        exportValue: (r) =>
          ((r['branchIds'] as string[]) ?? []).map((b) => lookup('/branches', b)).join('; '),
      },
      active(t('table.active')),
    ],
  },
  'job-titles': {
    navKey: 'jobTitles',
    path: '/job-titles',
    perm: 'org.job_title',
    schema: jobTitleInput,
    fields: [
      ...base(),
      { name: 'jobGradeId', kind: 'select' },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: { isActive: true },
    remote: { jobGradeId: '/job-grades' },
    columns: (t, lang, lookup) => [
      codeCol(t),
      nameCol(t, lang),
      {
        key: 'grade',
        header: t('fields.jobGradeId'),
        render: (r) => lookup('/job-grades', r['jobGradeId']),
        exportValue: (r) => lookup('/job-grades', r['jobGradeId']),
      },
      active(t('table.active')),
    ],
  },
  'job-grades': {
    navKey: 'jobGrades',
    path: '/job-grades',
    perm: 'org.job_grade',
    schema: jobGradeInput,
    fields: [
      ...base(),
      { name: 'level', kind: 'number', min: 0, max: 1000 },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: { isActive: true, level: 0 },
    columns: (t, lang) => [
      codeCol(t),
      nameCol(t, lang),
      {
        key: 'level',
        header: t('fields.level'),
        render: (r) => String(r['level'] ?? ''),
        exportValue: (r) => Number(r['level']),
      },
      active(t('table.active')),
    ],
  },
  'work-locations': {
    navKey: 'workLocations',
    path: '/work-locations',
    perm: 'org.work_location',
    schema: workLocationInput,
    fields: [
      ...base(),
      { name: 'branchId', kind: 'select', required: true },
      { name: 'address', kind: 'text' },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: { isActive: true },
    remote: { branchId: '/branches' },
    columns: (t, lang, lookup) => [
      codeCol(t),
      nameCol(t, lang),
      {
        key: 'branch',
        header: t('fields.branchId'),
        render: (r) => lookup('/branches', r['branchId']),
        exportValue: (r) => lookup('/branches', r['branchId']),
      },
      active(t('table.active')),
    ],
  },
  'cost-centers': {
    navKey: 'costCenters',
    path: '/cost-centers',
    perm: 'org.cost_center',
    schema: costCenterInput,
    fields: [...base(), { name: 'parentId', kind: 'select' }, { name: 'isActive', kind: 'switch' }],
    defaults: { isActive: true },
    selfRef: 'parentId',
    columns: (t, lang, lookup) => [
      codeCol(t),
      nameCol(t, lang),
      {
        key: 'parent',
        header: t('fields.parentId'),
        render: (r) => lookup('/cost-centers', r['parentId']),
        exportValue: (r) => lookup('/cost-centers', r['parentId']),
      },
      active(t('table.active')),
    ],
  },
  currencies: {
    navKey: 'currencies',
    path: '/currencies',
    perm: 'system.currency',
    schema: currencyInput,
    fields: [
      { name: 'code', kind: 'text', required: true, ltr: true, lockOnEdit: true },
      { name: 'nameAr', kind: 'text', required: true },
      { name: 'nameEn', kind: 'text' },
      { name: 'symbol', kind: 'text', required: true },
      { name: 'symbolPosition', kind: 'select', required: true },
      { name: 'displayDecimals', kind: 'number', min: 0, max: 4 },
      { name: 'roundingMode', kind: 'select', required: true },
      { name: 'isBase', kind: 'switch' },
      { name: 'isActive', kind: 'switch' },
    ],
    defaults: {
      isActive: true,
      isBase: false,
      symbolPosition: 'before',
      displayDecimals: 2,
      roundingMode: 'half_up',
    },
    columns: (t, lang) => [
      codeCol(t),
      nameCol(t, lang),
      text('symbol', t('fields.symbol')),
      {
        key: 'isBase',
        header: t('fields.isBase'),
        render: (r) => (r['isBase'] === true ? '✓' : ''),
        exportValue: (r) => r['isBase'] === true,
      },
      active(t('table.active')),
    ],
  },
};

/** خيارات الحقول الثابتة (التعداد) مترجمة */
export const staticOptions = (
  t: TFunction,
): Record<string, { value: string; label: string }[]> => ({
  symbolPosition: ['before', 'after'].map((v) => ({ value: v, label: t(`fields.${v}`) })),
  roundingMode: ['half_up', 'half_even', 'down', 'up'].map((v) => ({
    value: v,
    label: t(`fields.${v}`),
  })),
});
