import { normalizeSearch } from './text.js';

/** أعمدة ملف استيراد الموظفين: العنوان العربي والإنجليزي كلاهما مقبول عند القراءة. */
export type ImportColumn = {
  key: string;
  ar: string;
  en: string;
  required?: boolean;
};

export const IMPORT_COLUMNS: readonly ImportColumn[] = [
  { key: 'employeeNo', ar: 'الرقم الوظيفي', en: 'employee_no' },
  { key: 'firstNameAr', ar: 'الاسم الأول (عربي)', en: 'first_name_ar', required: true },
  { key: 'fatherNameAr', ar: 'اسم الأب (عربي)', en: 'father_name_ar' },
  { key: 'grandfatherNameAr', ar: 'اسم الجد (عربي)', en: 'grandfather_name_ar' },
  { key: 'familyNameAr', ar: 'اسم العائلة (عربي)', en: 'family_name_ar', required: true },
  { key: 'firstNameEn', ar: 'الاسم الأول (إنجليزي)', en: 'first_name_en' },
  { key: 'fatherNameEn', ar: 'اسم الأب (إنجليزي)', en: 'father_name_en' },
  { key: 'grandfatherNameEn', ar: 'اسم الجد (إنجليزي)', en: 'grandfather_name_en' },
  { key: 'familyNameEn', ar: 'اسم العائلة (إنجليزي)', en: 'family_name_en' },
  { key: 'birthDate', ar: 'تاريخ الميلاد', en: 'birth_date' },
  { key: 'gender', ar: 'الجنس', en: 'gender' },
  { key: 'maritalStatus', ar: 'الحالة الاجتماعية', en: 'marital_status' },
  { key: 'nationality', ar: 'الجنسية (رمز الدولة)', en: 'nationality' },
  { key: 'firstHireDate', ar: 'تاريخ أول تعيين', en: 'first_hire_date' },
  { key: 'mobile', ar: 'الجوال', en: 'mobile' },
  { key: 'email', ar: 'البريد الإلكتروني', en: 'email' },
  { key: 'branchCode', ar: 'رمز الفرع', en: 'branch_code' },
  { key: 'departmentCode', ar: 'رمز القسم', en: 'department_code' },
  { key: 'jobTitleCode', ar: 'رمز المسمى الوظيفي', en: 'job_title_code' },
  { key: 'hireDate', ar: 'تاريخ التعيين', en: 'hire_date' },
  { key: 'employmentType', ar: 'نوع التوظيف', en: 'employment_type' },
  { key: 'accountingNo', ar: 'رقم المحاسبة', en: 'accounting_no' },
  { key: 'deviceCode', ar: 'كود جهاز البصمة', en: 'device_code' },
];

/** سقف الصفوف في الاستيراد المتزامن */
export const IMPORT_MAX_ROWS = 5000;

/** يطبّع عنوان عمود للمطابقة: تطبيع عربي، وإزالة المسافات والشرطات والأقواس. */
export const normalizeHeader = (h: string): string =>
  normalizeSearch(h).replace(/[\s_\-()（）]/g, '');

const HEADER_INDEX = new Map<string, string>(
  IMPORT_COLUMNS.flatMap((c) => [
    [normalizeHeader(c.ar), c.key] as [string, string],
    [normalizeHeader(c.en), c.key] as [string, string],
    [normalizeHeader(c.key), c.key] as [string, string],
  ]),
);

/** يربط ترويسة الملف بمفاتيح الأعمدة؛ غير المعروف يُعاد في unknown. */
export const mapHeaders = (
  headers: readonly unknown[],
): { keys: (string | null)[]; unknown: string[]; missing: string[] } => {
  const keys = headers.map((h) =>
    typeof h === 'string' || typeof h === 'number'
      ? (HEADER_INDEX.get(normalizeHeader(String(h))) ?? null)
      : null,
  );
  const unknown = headers.flatMap((h, i) =>
    keys[i] === null && h !== null && h !== undefined && String(h).trim() !== '' ? [String(h)] : [],
  );
  const found = new Set(keys);
  const missing = IMPORT_COLUMNS.filter((c) => c.required && !found.has(c.key)).map((c) => c.key);
  return { keys, unknown, missing };
};

const GENDER: Record<string, 'male' | 'female'> = {
  ذكر: 'male',
  male: 'male',
  m: 'male',
  انثي: 'female',
  انثى: 'female',
  female: 'female',
  f: 'female',
};
const MARITAL: Record<string, 'single' | 'married' | 'divorced' | 'widowed'> = {
  اعزب: 'single',
  عزباء: 'single',
  single: 'single',
  متزوج: 'married',
  متزوجه: 'married',
  married: 'married',
  مطلق: 'divorced',
  مطلقه: 'divorced',
  divorced: 'divorced',
  ارمل: 'widowed',
  ارمله: 'widowed',
  widowed: 'widowed',
};
const EMPLOYMENT_TYPE: Record<string, 'full_time' | 'part_time' | 'temporary' | 'contractor'> = {
  'دوام كامل': 'full_time',
  full_time: 'full_time',
  fulltime: 'full_time',
  'دوام جزئي': 'part_time',
  part_time: 'part_time',
  parttime: 'part_time',
  مؤقت: 'temporary',
  temporary: 'temporary',
  متعاقد: 'contractor',
  contractor: 'contractor',
};

const normalized = <T>(table: Record<string, T>): Map<string, T> =>
  new Map(Object.entries(table).map(([k, v]) => [normalizeSearch(k), v]));
const GENDER_MAP = normalized(GENDER);
const MARITAL_MAP = normalized(MARITAL);
const TYPE_MAP = normalized(EMPLOYMENT_TYPE);
const lookup = <T>(table: Map<string, T>, v: string): T | undefined =>
  table.get(normalizeSearch(v));
export const parseGender = (v: string) => lookup(GENDER_MAP, v);
export const parseMarital = (v: string) => lookup(MARITAL_MAP, v);
export const parseEmploymentType = (v: string) => lookup(TYPE_MAP, v);

/** يحوّل تاريخ خلية إلى YYYY-MM-DD: خلية تاريخ (Date) أو نص ISO؛ غير ذلك null. */
export const parseImportDate = (v: unknown): string | null => {
  if (v instanceof Date) {
    return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  }
  if (typeof v !== 'string') return null;
  const s = normalizeSearch(v);
  const m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
  if (!m) return null;
  const iso = `${m[1]}-${m[2]?.padStart(2, '0')}-${m[3]?.padStart(2, '0')}`;
  const d = new Date(`${iso}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === iso ? iso : null;
};

export type ImportRowResult = {
  /** رقم الصف في الملف (الترويسة = 1) */
  row: number;
  action: 'create' | 'update' | 'error';
  employeeNo: string | null;
  name: string;
  errors: string[];
  warnings: string[];
};

export type ImportReport = {
  dryRun: boolean;
  total: number;
  created: number;
  updated: number;
  failed: number;
  /** هل حُفظت التغييرات فعلاً */
  committed: boolean;
  unknownColumns: string[];
  rows: ImportRowResult[];
};
