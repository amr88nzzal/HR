import { z } from 'zod';
import { csvList } from './employees.js';
import { num } from './formula.js';

export const SHORTFALL_METHODS = ['minutes', 'tiers'] as const;
export const SHORTFALL_TARGETS = ['salary', 'leave', 'split', 'waive'] as const;
export type ShortfallTarget = (typeof SHORTFALL_TARGETS)[number];

export const shortfallTier = z.object({
  /** عدد مرات النقص في الشهر الذي تبدأ منه الشريحة */
  from: z.number().int().min(1).max(31),
  /** جزء اليوم المخصوم عند بلوغ الشريحة (أعلى شريحة مستوفاة هي المطبَّقة) */
  dayFraction: z.string().regex(/^\d{1,2}(\.\d{1,4})?$/, 'جزء يوم غير صالح'),
});
export type ShortfallTier = z.infer<typeof shortfallTier>;

export const shortfallPolicyInput = z
  .object({
    isEnabled: z.boolean(),
    method: z.enum(SHORTFALL_METHODS),
    countLate: z.boolean(),
    countEarly: z.boolean(),
    monthlyFreeMinutes: z.number().int().min(0).max(10000),
    minutesPerDay: z.number().int().min(60).max(1440),
    tiers: z.array(shortfallTier).max(12),
    defaultTarget: z.enum(['salary', 'leave']),
    leaveTypeId: z.string().uuid().nullable(),
    suggestActionAfter: z.number().int().min(1).max(31).nullable(),
    version: z.number().int().optional(),
  })
  .refine((v) => v.countLate || v.countEarly, {
    message: 'فعّل التأخير أو المغادرة المبكرة على الأقل',
    path: ['countLate'],
  })
  .refine((v) => v.defaultTarget !== 'leave' || v.leaveTypeId !== null, {
    message: 'حدّد نوع الإجازة للخصم من الرصيد',
    path: ['leaveTypeId'],
  })
  .refine((v) => v.method !== 'tiers' || v.tiers.length > 0, {
    message: 'أضف شريحة واحدة على الأقل',
    path: ['tiers'],
  })
  .refine((v) => new Set(v.tiers.map((t) => t.from)).size === v.tiers.length, {
    message: 'بداية الشريحة مكررة',
    path: ['tiers'],
  });
export type ShortfallPolicyInput = z.infer<typeof shortfallPolicyInput>;

export const shortfallDecisionInput = z
  .object({
    employeeId: z.string().uuid(),
    year: z.number().int().min(2000).max(2100),
    month: z.number().int().min(1).max(12),
    target: z.enum(SHORTFALL_TARGETS),
    /** أيام الخصم من الرصيد (للتقسيم فقط) */
    leaveDays: z
      .string()
      .regex(/^\d{1,4}(\.\d{1,2})?$/, 'عدد أيام غير صالح')
      .optional(),
    reason: z.string().trim().min(2).max(300),
  })
  .refine((v) => (v.target === 'split') === (v.leaveDays !== undefined), {
    message: 'أيام الرصيد تُحدَّد مع التقسيم فقط',
    path: ['leaveDays'],
  })
  .refine((v) => v.leaveDays === undefined || num(v.leaveDays).gt(0), {
    message: 'أيام الرصيد يجب أن تكون أكبر من صفر',
    path: ['leaveDays'],
  });
export type ShortfallDecisionInput = z.infer<typeof shortfallDecisionInput>;

export const shortfallReportQuery = z.object({
  year: z.coerce.number().int().min(2000).max(2100),
  month: z.coerce.number().int().min(1).max(12),
  q: z.string().trim().max(100).optional(),
  branchId: csvList(z.string().uuid()),
  departmentId: csvList(z.string().uuid()),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(200),
});

export type ShortfallPolicy = Omit<ShortfallPolicyInput, 'version'>;

export type ShortfallCalc = {
  lateMinutes: number;
  earlyMinutes: number;
  /** عدد أيام فيها نقص (تأخير أو مغادرة مبكرة حسب السياسة) */
  occurrences: number;
  totalMinutes: number;
  chargeableMinutes: number;
  /** الأيام المستحقة قبل اختيار الهدف */
  daysDue: string;
};

/**
 * الأيام المستحقة من نقص الدوام في الشهر.
 * minutes: (مجموع الدقائق المحتسبة − السماحية الشهرية) ÷ دقائق اليوم المكافئ (أربع خانات).
 * tiers: جزء اليوم لأعلى شريحة بلغها عدد مرات النقص، بلا اعتبار للدقائق.
 */
export const computeShortfall = (
  policy: Pick<
    ShortfallPolicy,
    'method' | 'countLate' | 'countEarly' | 'monthlyFreeMinutes' | 'minutesPerDay' | 'tiers'
  >,
  days: { late: number; early: number }[],
): ShortfallCalc => {
  let late = 0;
  let early = 0;
  let occurrences = 0;
  for (const d of days) {
    const l = policy.countLate ? d.late : 0;
    const e = policy.countEarly ? d.early : 0;
    late += l;
    early += e;
    if (l > 0 || e > 0) occurrences++;
  }
  const total = late + early;
  const chargeable = Math.max(0, total - policy.monthlyFreeMinutes);
  let daysDue = num(0);
  if (policy.method === 'minutes') {
    daysDue = num(chargeable).div(policy.minutesPerDay).toDecimalPlaces(4, 1);
  } else {
    const hit = [...policy.tiers]
      .sort((a, b) => a.from - b.from)
      .filter((t) => t.from <= occurrences)
      .pop();
    if (hit && chargeable > 0) daysDue = num(hit.dayFraction);
  }
  return {
    lateMinutes: late,
    earlyMinutes: early,
    occurrences,
    totalMinutes: total,
    chargeableMinutes: chargeable,
    daysDue: daysDue.toFixed(4),
  };
};

export type ShortfallSplit = {
  daysLeave: string;
  daysSalary: string;
  /** عدم كفاية الرصيد: الباقي حُوِّل إلى الراتب */
  balanceShort: boolean;
};

/** يوزّع الأيام المستحقة بين الرصيد والراتب بحسب الهدف، ويقصّ الرصيد على المتاح (سنتان عشريتان). */
export const splitShortfall = (
  daysDue: string,
  target: ShortfallTarget,
  opts: { leaveDays?: string | null | undefined; available: string },
): ShortfallSplit => {
  const due = num(daysDue);
  if (target === 'waive' || due.isZero())
    return { daysLeave: '0.00', daysSalary: '0.0000', balanceShort: false };
  const want =
    target === 'salary'
      ? num(0)
      : target === 'leave'
        ? due
        : num(opts.leaveDays ?? 0).lt(due)
          ? num(opts.leaveDays ?? 0)
          : due;
  const avail = num(opts.available).lt(0) ? num(0) : num(opts.available);
  const wantRounded = want.toDecimalPlaces(2, 1);
  const leave = wantRounded.gt(avail) ? avail.toDecimalPlaces(2, 1) : wantRounded;
  return {
    daysLeave: leave.toFixed(2),
    daysSalary: due.minus(leave).toFixed(4),
    balanceShort: wantRounded.gt(avail),
  };
};
