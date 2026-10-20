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
/**
 * تسوية مبكرة: `payroll` تدمج الأقساط المتبقية في قسط واحد يُخصم من راتب الشهر المحدد (يخضع لسقف الصافي)،
 * و`cash` يسدد الموظف المتبقي خارج الرواتب فتُغلق السلفة فوراً ويُسجَّل المبلغ والمرجع.
 * Early settlement: `payroll` merges the remaining installments into one deducted in the chosen month
 * (subject to the net cap); `cash` closes the loan at once, recording amount and reference.
 */
export const loanSettleInput = z.discriminatedUnion('mode', [
  z.object({
    mode: z.literal('payroll'),
    reason: z.string().trim().min(2).max(300),
    targetYear: z.number().int().min(2000).max(2100),
    targetMonth: z.number().int().min(1).max(12),
  }),
  z.object({
    mode: z.literal('cash'),
    reason: z.string().trim().min(2).max(300),
    reference: z.string().trim().max(120).optional(),
  }),
]);
export type LoanSettleInput = z.infer<typeof loanSettleInput>;
export const DEFER_MODES = ['month', 'remaining'] as const;
/**
 * تأجيل قسط. المبلغ المؤجَّل (افتراضياً كامل القسط) يُلحَق إما بأقساط جديدة تبدأ من شهر محدد
 * (`month`: عددها `count` ويساوي 1 افتراضياً) أو يُوزَّع على الأقساط المتبقية (`remaining`: أول `count` منها، أو كلها).
 */
export const installmentDeferInput = z
  .object({
    reason: z.string().trim().min(2).max(300),
    /** المبلغ المؤجَّل؛ يُهمَل = القسط كاملاً */
    amount: z
      .string()
      .regex(/^\d{1,14}(\.\d{1,4})?$/, 'مبلغ غير صالح')
      .optional(),
    mode: z.enum(DEFER_MODES).default('month'),
    count: z.number().int().min(1).max(120).optional(),
    targetYear: z.number().int().min(2000).max(2100).optional(),
    targetMonth: z.number().int().min(1).max(12).optional(),
  })
  .refine((v) => (v.targetYear === undefined) === (v.targetMonth === undefined), {
    message: 'حدّد السنة والشهر معاً',
    path: ['targetMonth'],
  });
export type InstallmentDeferInput = z.infer<typeof installmentDeferInput>;

export type DeferRemaining = { id: string; year: number; month: number; amount: string };
export type DeferRow = {
  /** null = قسط جديد يُنشأ؛ وإلا قسط قائم يزداد */
  id: string | null;
  year: number;
  month: number;
  /** المبلغ المضاف */
  add: string;
  /** المبلغ بعد التأجيل */
  total: string;
};
export type DeferPlan =
  | { ok: true; keep: string; full: boolean; rows: DeferRow[] }
  | {
      ok: false;
      code: 'INVALID_DEFER_AMOUNT' | 'INVALID_TARGET_MONTH' | 'NO_REMAINING' | 'INVALID_COUNT';
    };

/** خطة التأجيل (للمعاينة في الواجهة والتنفيذ في الخادم بالمنطق نفسه). */
export const planDefer = (i: {
  amount: string;
  deferAmount?: string | undefined;
  dueYear: number;
  dueMonth: number;
  mode: (typeof DEFER_MODES)[number];
  targetYear?: number | undefined;
  targetMonth?: number | undefined;
  count?: number | undefined;
  remaining: DeferRemaining[];
}): DeferPlan => {
  const whole = num(i.amount);
  const d = i.deferAmount === undefined ? whole : num(i.deferAmount);
  if (!d.gt(0) || d.gt(whole)) return { ok: false, code: 'INVALID_DEFER_AMOUNT' };
  const keep = whole.minus(d);
  const base = { keep: keep.toFixed(4), full: keep.isZero() };
  if (i.mode === 'month') {
    if (i.targetYear === undefined || i.targetMonth === undefined)
      return { ok: false, code: 'INVALID_TARGET_MONTH' };
    if (i.targetYear * 12 + i.targetMonth <= i.dueYear * 12 + i.dueMonth)
      return { ok: false, code: 'INVALID_TARGET_MONTH' };
    const n = i.count ?? 1;
    const rows = buildSchedule(d.toFixed(4), n, i.targetYear, i.targetMonth).map((r) => ({
      id: null,
      year: r.year,
      month: r.month,
      add: r.amount,
      total: r.amount,
    }));
    return { ok: true, ...base, rows };
  }
  const list = [...i.remaining].sort((a, b) => a.year * 12 + a.month - (b.year * 12 + b.month));
  if (!list.length) return { ok: false, code: 'NO_REMAINING' };
  const k = i.count ?? list.length;
  if (k > list.length) return { ok: false, code: 'INVALID_COUNT' };
  const parts = buildSchedule(d.toFixed(4), k, 2000, 1);
  const rows = list.slice(0, k).map((r, idx) => ({
    id: r.id,
    year: r.year,
    month: r.month,
    add: parts[idx]!.amount,
    total: num(r.amount).plus(parts[idx]!.amount).toFixed(4),
  }));
  return { ok: true, ...base, rows };
};

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
