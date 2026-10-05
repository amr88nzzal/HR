import { z } from 'zod';

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'الرمز أحرف لاتينية وأرقام و - _ فقط');
const nameAr = z.string().trim().min(1).max(200);
const nameEn = z.string().trim().max(200).nullish();
const optText = (max = 300) => z.string().trim().max(max).nullish();
const uuid = z.string().uuid();

/** كل التعديلات تتطلب `version` الحالي (قفل متفائل). */
export const withVersion = <T extends z.ZodRawShape>(shape: T) =>
  z.object(shape).partial().extend({ version: z.number().int().positive() });

export const branchInput = z.object({
  code,
  nameAr,
  nameEn,
  country: optText(60),
  city: optText(100),
  address: optText(500),
  phone: optText(40),
  timezone: optText(60),
  isActive: z.boolean().default(true),
});

export const currencyInput = z.object({
  code: z.string().regex(/^[A-Z]{3}$/, 'رمز العملة ثلاثة أحرف كبيرة (ISO 4217)'),
  nameAr,
  nameEn,
  symbol: z.string().trim().min(1).max(10),
  symbolPosition: z.enum(['before', 'after']).default('before'),
  displayDecimals: z.number().int().min(0).max(4).default(2),
  roundingMode: z.enum(['half_up', 'half_even', 'down', 'up']).default('half_up'),
  isBase: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const jobGradeInput = z.object({
  code,
  nameAr,
  nameEn,
  level: z.number().int().min(0).max(1000).default(0),
  isActive: z.boolean().default(true),
});

export const jobTitleInput = z.object({
  code,
  nameAr,
  nameEn,
  jobGradeId: uuid.nullish(),
  isActive: z.boolean().default(true),
});

export const workLocationInput = z.object({
  code,
  nameAr,
  nameEn,
  branchId: uuid,
  address: optText(500),
  isActive: z.boolean().default(true),
});

export const costCenterInput = z.object({
  code,
  nameAr,
  nameEn,
  parentId: uuid.nullish(),
  isActive: z.boolean().default(true),
});

export const departmentInput = z.object({
  code,
  nameAr,
  nameEn,
  parentId: uuid.nullish(),
  /** فرع واحد على الأقل */
  branchIds: z.array(uuid).min(1, 'يلزم فرع واحد على الأقل'),
  isActive: z.boolean().default(true),
});

export const listQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  q: z.string().trim().max(100).optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
});
export type ListQuery = z.infer<typeof listQuery>;

// ---- الإعدادات ----
/** مفاتيح الإعدادات المسموحة وقيمها الافتراضية وتحقق قيمها. */
export const SETTING_DEFS = {
  locale: { schema: z.enum(['ar', 'en']), default: 'ar' },
  timezone: { schema: z.string().min(1).max(60), default: 'Asia/Riyadh' },
  calendar: { schema: z.enum(['gregorian', 'hijri']), default: 'gregorian' },
  dateFormat: { schema: z.enum(['DD/MM/YYYY', 'MM/DD/YYYY', 'YYYY-MM-DD']), default: 'DD/MM/YYYY' },
  timeFormat: { schema: z.enum(['12h', '24h']), default: '12h' },
  weekStart: { schema: z.number().int().min(0).max(6), default: 6 },
  numberDigits: { schema: z.enum(['western', 'arabic']), default: 'western' },
  decimalSeparator: { schema: z.enum(['.', ',']), default: '.' },
  thousandsSeparator: { schema: z.enum([',', '.', ' ', '']), default: ',' },
  /** صيغة الرقم الوظيفي: {seq:N} إلزامي، و{yy}/{yyyy} اختياريان */
  employeeNoFormat: {
    schema: z
      .string()
      .max(40)
      .refine(
        (v) => /\{seq:[1-9]\}/.test(v) && /^[A-Za-z0-9_\-{}:]+$/.test(v),
        'صيغة رقم وظيفي غير صالحة',
      ),
    default: 'EMP-{seq:5}',
  },
} as const;
export type SettingKey = keyof typeof SETTING_DEFS;
export const settingKeys = Object.keys(SETTING_DEFS) as SettingKey[];

export const auditQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  entityType: z.string().max(60).optional(),
  entityId: z.string().max(60).optional(),
  userId: uuid.optional(),
  action: z.string().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
