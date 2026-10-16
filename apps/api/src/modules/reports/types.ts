import type { RawBuilder } from 'kysely';
import type { AuthContext } from '../identity/index.js';

export type Row = Record<string, unknown>;
export type Opt = { value: string; labelAr: string; labelEn: string };

/** text = نص، number = عدد، money = مبلغ (خانتان على الأقل)، date = YYYY-MM-DD، enum = قيمة بتسمية */
export type ColType = 'text' | 'number' | 'money' | 'date' | 'enum';

export type ReportColumn = {
  key: string;
  labelAr: string;
  labelEn: string;
  type: ColType;
  /** للنوع enum: تسميات القيم في التصدير والواجهة */
  options?: Opt[];
  /** يُحجب العمود تماماً (لا يغادر الخادم) عمّن لا يملك هذه الصلاحية */
  requires?: string;
  /** ليس ضمن الأعمدة الافتراضية */
  optional?: boolean;
};

export type FilterType = 'date' | 'month' | 'text' | 'uuid' | 'select' | 'number';
export type ReportFilter = {
  key: string;
  type: FilterType;
  labelAr: string;
  labelEn: string;
  required?: boolean;
  options?: Opt[];
  /** للنوع uuid: مصدر القائمة في الواجهة (مسار API) */
  ref?: 'branches' | 'departments' | 'leave-types' | 'payroll-periods';
};

export type ReportManifest = {
  code: string;
  module: 'employees' | 'leave' | 'attendance' | 'payroll';
  titleAr: string;
  titleEn: string;
  descriptionAr: string;
  descriptionEn: string;
  /** صلاحية الاطلاع؛ تُطبَّق معها نطاقاتها على الموظفين حيث ينطبق */
  permission: string;
  columns: ReportColumn[];
  filters: ReportFilter[];
};

export type Filters = Record<string, string | undefined>;

export type ReportDef = {
  manifest: ReportManifest;
  /** استعلام كامل بلا ORDER BY؛ يجب أن تظهر أعمدة الترتيب في قائمة الاختيار. يكتب النطاق على جدول employees بلا اسم مستعار. */
  query: (auth: AuthContext, scope: RawBuilder<boolean> | null, f: Filters) => RawBuilder<Row>;
  /** ترتيب ثابت (من الكود فقط) لتجانب الصفحات */
  orderBy: string;
};
