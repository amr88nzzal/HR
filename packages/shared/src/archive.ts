import { z } from 'zod';
import { withVersion } from './org.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');
const optTxt = (max: number) => z.string().trim().max(max).nullish();

export const ownerTypeEnum = z.enum(['employee', 'branch', 'company']);
export type OwnerType = z.infer<typeof ownerTypeEnum>;

export const documentTypeInput = z.object({
  systemKey: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/)
    .nullish(),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: optTxt(200),
  category: optTxt(100),
  ownerType: ownerTypeEnum,
  isRequired: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
/** مالك النوع ومفتاحه النظامي لا يتغيران بعد الإنشاء */
export const documentTypeUpdateInput = withVersion(
  documentTypeInput.omit({ systemKey: true, ownerType: true }).shape,
);

export const fieldDataTypeEnum = z.enum([
  'text',
  'long_text',
  'number',
  'date',
  'amount',
  'boolean',
  'select',
  'file',
  'reminder_date',
]);
export type FieldDataType = z.infer<typeof fieldDataTypeEnum>;

export const selectOption = z.object({
  value: z.string().trim().min(1).max(60),
  labelAr: z.string().trim().min(1).max(100),
  labelEn: optTxt(100),
});
/** قواعد تحقق اختيارية للنص/الرقم */
export const fieldRules = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  regex: z
    .string()
    .max(200)
    .refine((v) => {
      try {
        new RegExp(v);
        return true;
      } catch {
        return false;
      }
    }, 'تعبير نمطي غير صالح')
    .optional(),
});

export const documentFieldInput = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-zA-Z0-9]{0,39}$/, 'مفتاح camelCase لاتيني'),
    labelAr: z.string().trim().min(1).max(200),
    labelEn: optTxt(200),
    dataType: fieldDataTypeEnum,
    isRequired: z.boolean().default(false),
    isSensitive: z.boolean().default(false),
    isUnique: z.boolean().default(false),
    options: z.union([z.array(selectOption).max(100), fieldRules]).default([]),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    showInList: z.boolean().default(false),
    isActive: z.boolean().default(true),
  })
  .superRefine((v, ctx) => {
    if (v.dataType === 'select' && !(Array.isArray(v.options) && v.options.length > 0))
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'القائمة تحتاج خياراً واحداً' });
    if (v.dataType !== 'select' && Array.isArray(v.options) && v.options.length > 0)
      ctx.addIssue({ code: 'custom', path: ['options'], message: 'الخيارات خاصة بحقول القائمة' });
    if (v.isSensitive && v.isUnique)
      ctx.addIssue({ code: 'custom', path: ['isUnique'], message: 'الحقل الحساس لا يكون فريداً' });
    if (v.isSensitive && ['file', 'reminder_date'].includes(v.dataType))
      ctx.addIssue({ code: 'custom', path: ['isSensitive'], message: 'لا يصلح لهذا النوع' });
  });
/** المفتاح والنوع وحساسية الحقل ثابتة بعد الإنشاء (تحدد شكل البيانات المخزّنة) */
export const documentFieldUpdateInput = withVersion({
  labelAr: z.string().trim().min(1).max(200),
  labelEn: optTxt(200),
  isRequired: z.boolean(),
  isUnique: z.boolean(),
  options: z.union([z.array(selectOption).max(100), fieldRules]),
  sortOrder: z.number().int().min(0).max(10000),
  showInList: z.boolean(),
  isActive: z.boolean(),
});

export const documentInput = z.object({
  documentTypeId: uuid,
  /** للموظف/الفرع معرّفه؛ للشركة يُترك فارغاً */
  ownerId: uuid.nullish(),
  values: z.record(z.string(), z.unknown()).default({}),
});
export const documentUpdateInput = z.object({
  version: z.number().int().positive(),
  values: z.record(z.string(), z.unknown()),
});
export const supersedeInput = z.object({
  /** القيم الجديدة؛ ما لم يُذكر يُنسخ من الوثيقة السابقة */
  values: z.record(z.string(), z.unknown()).default({}),
});

export const documentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(25),
  documentTypeId: uuid.optional(),
  ownerType: ownerTypeEnum.optional(),
  ownerId: uuid.optional(),
  status: z.enum(['active', 'superseded']).default('active'),
});

export const reminderListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  status: z.enum(['pending', 'done', 'dismissed']).default('pending'),
  /** حتى هذا التاريخ (شامل)؛ الافتراضي بلا حد */
  dueBefore: date.optional(),
});
export const reminderUpdateInput = withVersion({
  status: z.enum(['pending', 'done', 'dismissed']),
});

/** أنواع الملفات المسموحة ولا يُعتمد على ترويسة المتصفح بل على توقيع الملف. */
export const ALLOWED_FILE_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
} as const;
export const MAX_FILE_BYTES = 20 * 1024 * 1024;
