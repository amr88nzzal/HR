export type Opt = { value: string; labelAr: string; labelEn: string };
export type Col = {
  key: string;
  labelAr: string;
  labelEn: string;
  type: 'text' | 'number' | 'money' | 'date' | 'enum';
  options?: Opt[];
  optional?: boolean;
};
export type Filter = {
  key: string;
  type: 'date' | 'month' | 'text' | 'uuid' | 'select' | 'number';
  labelAr: string;
  labelEn: string;
  required?: boolean;
  options?: Opt[];
  ref?: 'branches' | 'departments' | 'leave-types' | 'payroll-periods';
};
export type Manifest = {
  code: string;
  module: 'employees' | 'leave' | 'attendance' | 'payroll';
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  columns: Col[];
  filters: Filter[];
};
export type Layout = { id: string; name: string; columns: string[]; isDefault: boolean };
export type RunRow = {
  id: string;
  reportCode: string;
  format: string;
  mode: 'direct' | 'job';
  status: 'queued' | 'running' | 'done' | 'failed';
  rowCount: number | null;
  createdAt: string;
  downloadable: boolean;
  userEmail: string;
};
export const FORMATS = ['csv', 'xlsx', 'html', 'pdf'] as const;
export type Format = (typeof FORMATS)[number];

/** يحوّل عمود القيمة لنص عرض (enum بتسميته) */
export const cellView = (c: Col, v: unknown, lang: string): string => {
  if (v === null || v === undefined) return '';
  if (c.type === 'enum') {
    const o = c.options?.find((x) => x.value === v);
    return o ? (lang === 'en' ? o.labelEn : o.labelAr) : String(v);
  }
  return String(v);
};
