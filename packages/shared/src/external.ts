import { z } from 'zod';
import { withVersion } from './org.js';

const uuid = z.string().uuid();
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ بصيغة YYYY-MM-DD');
const optTxt = (max: number) => z.string().trim().max(max).nullish();

/**
 * يطبّع قيمة مرجع خارجي: يحوّل الأرقام العربية-الهندية والفارسية إلى لاتينية،
 * ويزيل المحارف غير المرئية والمسافات الطرفية. الأصفار البادئة محفوظة (القيمة نص).
 */
export const normalizeRefValue = (raw: string): string =>
  raw
    .replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660))
    .replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0))
    .replace(/[\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '')
    .trim();

export const externalPurposeEnum = z.enum(['accounting', 'attendance_device', 'other']);
export const refScopeEnum = z.enum(['company', 'branch']);

export const externalSystemInput = z.object({
  key: z
    .string()
    .trim()
    .regex(/^[a-z][a-z0-9_]{1,39}$/, 'مفتاح لاتيني صغير (حروف وأرقام و _) يبدأ بحرف'),
  nameAr: z.string().trim().min(1).max(200),
  nameEn: optTxt(200),
  purpose: externalPurposeEnum.default('other'),
  refScope: refScopeEnum.default('company'),
  isUnique: z.boolean().default(true),
  validationRegex: z
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
    .nullish(),
  isActive: z.boolean().default(true),
});
export const externalSystemUpdateInput = withVersion(externalSystemInput.shape);

export const externalRefInput = z
  .object({
    systemId: uuid,
    value: z.string().min(1).max(100),
    branchId: uuid.nullish(),
    validFrom: date.nullish(),
    validTo: date.nullish(),
    isPrimary: z.boolean().default(true),
    notes: optTxt(500),
  })
  .refine((v) => !v.validFrom || !v.validTo || v.validTo >= v.validFrom, {
    message: 'نهاية الصلاحية قبل بدايتها',
    path: ['validTo'],
  });
export const externalRefUpdateInput = withVersion({
  value: z.string().min(1).max(100),
  branchId: uuid.nullable(),
  validFrom: date.nullable(),
  validTo: date.nullable(),
  isPrimary: z.boolean(),
  notes: z.string().trim().max(500).nullable(),
});

/** بحث عن موظف بمرجع خارجي (يستعمله الاستيراد والتكامل). */
export const externalRefResolveQuery = z.object({
  system: z.string().trim().min(1),
  value: z.string().min(1).max(100),
  date: date.optional(),
  branchId: uuid.optional(),
});

export const customFieldTypeEnum = z.enum(['text', 'number', 'date', 'boolean', 'select']);
export const customFieldOption = z.object({
  value: z.string().trim().min(1).max(60),
  labelAr: z.string().trim().min(1).max(100),
  labelEn: optTxt(100),
});
export const customFieldDefinitionInput = z
  .object({
    key: z
      .string()
      .trim()
      .regex(/^[a-z][a-zA-Z0-9]{1,39}$/, 'مفتاح camelCase لاتيني يبدأ بحرف صغير'),
    labelAr: z.string().trim().min(1).max(200),
    labelEn: optTxt(200),
    fieldType: customFieldTypeEnum,
    options: z.array(customFieldOption).max(100).default([]),
    isRequired: z.boolean().default(false),
    isSensitive: z.boolean().default(false),
    sortOrder: z.number().int().min(0).max(10000).default(0),
    isActive: z.boolean().default(true),
  })
  .refine((v) => v.fieldType !== 'select' || v.options.length > 0, {
    message: 'حقل القائمة يحتاج خياراً واحداً على الأقل',
    path: ['options'],
  });
export const customFieldDefinitionUpdateInput = withVersion({
  labelAr: z.string().trim().min(1).max(200),
  labelEn: optTxt(200),
  options: z.array(customFieldOption).max(100),
  isRequired: z.boolean(),
  isSensitive: z.boolean(),
  sortOrder: z.number().int().min(0).max(10000),
  isActive: z.boolean(),
});

/** كشف حقل مخصص حساس لموظف (مدقَّق). */
export const revealFieldInput = z.object({ key: z.string().trim().min(1).max(40) });
