import { z } from 'zod';

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z0-9_-]+$/, 'الرمز أحرف لاتينية وأرقام و - _ فقط');
const nameAr = z.string().trim().min(1).max(200);
const nameEn = z.string().trim().max(200).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');
const days = z.number().min(0).max(999.99);

export const leaveTypeInput = z.object({
  code,
  nameAr,
  nameEn,
  isPaid: z.boolean().default(true),
  allowHalfDay: z.boolean().default(true),
  requiresAttachment: z.boolean().default(false),
  color: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .nullish(),
  isActive: z.boolean().default(true),
});

export const ACCRUAL_METHODS = ['monthly', 'upfront'] as const;

export const leavePolicyInput = z.object({
  code,
  nameAr,
  nameEn,
  leaveTypeId: uuid,
  annualEntitlement: days,
  accrualMethod: z.enum(ACCRUAL_METHODS).default('monthly'),
  carryOverMax: days.default(0),
  carryOverValidMonths: z.number().int().min(1).max(24).nullish(),
  maxNegative: days.default(0),
  minServiceMonths: z.number().int().min(0).max(120).default(0),
  isActive: z.boolean().default(true),
});

export const holidayInput = z.object({
  holidayDate: isoDate,
  nameAr,
  nameEn,
});

export const POLICY_SCOPES = ['company', 'branch', 'department', 'employee'] as const;
export type PolicyScope = (typeof POLICY_SCOPES)[number];

export const leaveAssignmentInput = z
  .object({
    policyId: uuid,
    scope: z.enum(POLICY_SCOPES),
    scopeRef: uuid.nullish(),
    validFrom: isoDate.optional(),
  })
  .refine((v) => (v.scope === 'company') === !v.scopeRef, {
    message: 'النطاق غير الشركة يتطلب مرجعاً، وللشركة بلا مرجع',
    path: ['scopeRef'],
  });

/** أيام الراحة الأسبوعية: 0=الأحد … 6=السبت */
export const weeklyOffSchema = z
  .array(z.number().int().min(0).max(6))
  .max(6, 'لا يمكن أن تكون كل أيام الأسبوع راحة')
  .refine((a) => new Set(a).size === a.length, 'أيام مكررة');
