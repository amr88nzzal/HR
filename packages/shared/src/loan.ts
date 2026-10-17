import { z } from 'zod';
import { num } from './formula.js';
import { money } from './payroll.js';

const uuid = z.string().uuid();

export const LOAN_KINDS = ['loan', 'advance'] as const;

export type ScheduleItem = { no: number; year: number; month: number; amount: string };

/** جدول الأقساط: أقساط متساوية بأربع خانات والفرق على القسط الأخير، شهرياً من (سنة، شهر) الأول. */
export const buildSchedule = (
  principal: string,
  count: number,
  firstYear: number,
  firstMonth: number,
): ScheduleItem[] => {
  const total = num(principal);
  const each = total.div(count).toDecimalPlaces(4, 1); // ROUND_DOWN
  const out: ScheduleItem[] = [];
  let paid = num(0);
  for (let i = 0; i < count; i++) {
    const idx = firstMonth - 1 + i;
    const amount = i === count - 1 ? total.minus(paid) : each;
    paid = paid.plus(amount);
    out.push({
      no: i + 1,
      year: firstYear + Math.floor(idx / 12),
      month: (idx % 12) + 1,
      amount: amount.toFixed(4),
    });
  }
  return out;
};

export const loanInput = z.object({
  employeeId: uuid,
  kind: z.enum(LOAN_KINDS).default('loan'),
  currency: z.string().regex(/^[A-Z]{3}$/),
  principal: money.refine((v) => num(v).gt(0), 'المبلغ يجب أن يكون أكبر من صفر'),
  installmentsCount: z.number().int().min(1).max(120),
  firstYear: z.number().int().min(2000).max(2100),
  firstMonth: z.number().int().min(1).max(12),
  reason: z.string().trim().max(300).nullish(),
});
export type LoanInput = z.infer<typeof loanInput>;

export const loanListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  employeeId: uuid.optional(),
  status: z.enum(['active', 'settled', 'cancelled']).optional(),
});

export const loanCancelInput = z.object({ reason: z.string().trim().min(2).max(300) });
/** تأجيل قسط: كامل القسط أو جزء منه، إلى شهر يحدده المدير (افتراضياً بعد آخر قسط)، بسبب إلزامي. */
export const installmentDeferInput = z
  .object({
    reason: z.string().trim().min(2).max(300),
    /** المبلغ المؤجَّل؛ يُهمَل = القسط كاملاً */
    amount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'مبلغ غير صالح')
      .optional(),
    targetYear: z.number().int().min(2000).max(2100).optional(),
    targetMonth: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => (v.targetYear === undefined) === (v.targetMonth === undefined), {
    message: 'حدّد السنة والشهر معاً',
    path: ['targetMonth'],
  });

export const PAYMENT_METHODS = ['bank', 'cash', 'other'] as const;
export const paymentMarkInput = z.object({
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).nullish(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
  note: z.string().trim().max(300).nullish(),
});
export const paymentBulkInput = z.object({
  ids: z.array(uuid).min(1).max(2000),
  method: z.enum(PAYMENT_METHODS),
  reference: z.string().trim().max(120).nullish(),
  paidAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاريخ غير صالح'),
});
export const paymentListQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
  periodId: uuid.optional(),
  kind: z.enum(['payslip', 'loan']).optional(),
  status: z.enum(['pending', 'paid']).optional(),
  employeeId: uuid.optional(),
});
