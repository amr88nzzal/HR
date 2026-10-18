import { z } from 'zod';
import { money } from './payroll.js';

const code = z
  .string()
  .trim()
  .min(1)
  .max(30)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/, 'الرمز أحرف لاتينية وأرقام و _ ويبدأ بحرف');
const nameAr = z.string().trim().min(1).max(200);
const nameEn = z.string().trim().max(200).nullish();
const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح');

export const payGroupInput = z.object({
  code,
  nameAr,
  nameEn,
  isActive: z.boolean().default(true),
});

export const payGroupAssignInput = z.object({ employeeId: uuid, validFrom: isoDate });

export const overrideReasonInput = z.object({
  code,
  nameAr,
  nameEn,
  isActive: z.boolean().default(true),
});

export const periodInput = z.object({
  payGroupId: uuid.nullish(),
  year: z.number().int().min(2000).max(2100),
  month: z.number().int().min(1).max(12),
  currency: z.string().regex(/^[A-Z]{3}$/),
});

/** المتغيرات التي يجوز تجاوزها يدوياً لموظف/دورة */
export const PAYROLL_INPUT_KEYS = [
  'days_in_period',
  'worked_days',
  'absent_days',
  'unpaid_leave_days',
  'overtime_hours',
  'late_minutes',
  'early_leave_minutes',
  'shortfall_minutes',
] as const;
export const periodInputsPut = z.object({
  items: z
    .array(
      z.object({
        employeeId: uuid,
        key: z.enum(PAYROLL_INPUT_KEYS),
        /** null = إزالة التجاوز والعودة للقيمة الآلية */
        value: money.nullable(),
        note: z.string().trim().max(300).nullish(),
      }),
    )
    .min(1)
    .max(2000),
});

export const lineOverrideInput = z.object({
  amount: money,
  reasonId: uuid,
  note: z.string().trim().max(300).nullish(),
});
export const addLineInput = z.object({
  kind: z.enum(['earning', 'deduction', 'employer']),
  nameAr,
  nameEn,
  amount: money,
  reasonId: uuid,
  note: z.string().trim().max(300).nullish(),
});
export const reopenInput = z.object({ reason: z.string().trim().min(3).max(300) });
export const simulateInput = z.object({ employeeIds: z.array(uuid).max(500).optional() });
export const payslipListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  q: z.string().trim().max(100).optional(),
  manualOnly: z.enum(['true', 'false']).optional(),
  sort: z
    .string()
    .regex(/^-?[a-zA-Z]{1,40}$/)
    .optional(),
});
