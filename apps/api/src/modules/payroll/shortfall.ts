import { sql } from 'kysely';
import {
  computeShortfall,
  num,
  splitShortfall,
  type ShortfallCalc,
  type ShortfallPolicy,
  type ShortfallTarget,
} from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { adjust, debit } from '../leave/index.js';
import type { EngineInput } from './engine.js';

type Row = Record<string, unknown>;
type Added = EngineInput['added'];

export const SHORTFALL_CODE = 'shortfall_deduction';
/** أساس سعر اليوم: الراتب ÷ 30 (كما في days_in_period لمتغيرات الاحتساب) */
export const SHORTFALL_DAY_BASE = 30;

export type LoadedPolicy = ShortfallPolicy & { version: number };

export const loadPolicy = async (ctx: Ctx): Promise<LoadedPolicy | null> => {
  const r = await ctx.trx
    .selectFrom('shortfallPolicies')
    .selectAll()
    .where('companyId', '=', ctx.companyId)
    .executeTakeFirst();
  if (!r) return null;
  return {
    isEnabled: r.isEnabled,
    method: r.method,
    countLate: r.countLate,
    countEarly: r.countEarly,
    monthlyFreeMinutes: r.monthlyFreeMinutes,
    minutesPerDay: r.minutesPerDay,
    tiers: (r.tiers as ShortfallPolicy['tiers']) ?? [],
    defaultTarget: r.defaultTarget,
    leaveTypeId: r.leaveTypeId,
    suggestActionAfter: r.suggestActionAfter,
    version: r.version,
  };
};

export type ShortfallEval = ShortfallCalc & {
  employeeId: string;
  /** الهدف المطبَّق: قرار المدير إن وُجد وإلا الافتراضي */
  target: ShortfallTarget;
  decided: boolean;
  decisionReason: string | null;
  leaveTypeId: string | null;
  available: string;
  daysLeave: string;
  daysSalary: string;
  balanceShort: boolean;
  suggestAction: boolean;
};

/**
 * نقص الدوام لموظفين في شهر: من أيام الحضور المحتسبة، ثم السياسة، ثم قرار المدير، ثم رصيد الإجازات.
 * تُرجَع الحالات التي فيها نقص أو قرار فقط؛ والسياسة المعطّلة لا تُرجع شيئاً.
 */
export const evaluateShortfall = async (
  ctx: Ctx,
  p: { year: number; month: number; startDate: string; endDate: string },
  employeeIds: string[],
  policyIn?: LoadedPolicy | null,
): Promise<Map<string, ShortfallEval>> => {
  const out = new Map<string, ShortfallEval>();
  const policy = policyIn === undefined ? await loadPolicy(ctx) : policyIn;
  if (!policy?.isEnabled || !employeeIds.length) return out;
  const { rows: days } = await sql<Row>`
    select employee_id, late_minutes, early_leave_minutes
      from attendance_days
     where company_id = ${ctx.companyId} and employee_id = any(${employeeIds}::uuid[])
       and day_date between ${p.startDate}::date and ${p.endDate}::date
       and (late_minutes > 0 or early_leave_minutes > 0)`.execute(ctx.trx);
  const byEmp = new Map<string, { late: number; early: number }[]>();
  for (const d of days) {
    const list = byEmp.get(d.employeeId as string) ?? [];
    list.push({ late: Number(d.lateMinutes), early: Number(d.earlyLeaveMinutes) });
    byEmp.set(d.employeeId as string, list);
  }
  const { rows: decs } = await sql<Row>`
    select employee_id, target, leave_days::text as leave_days, reason from shortfall_decisions
     where company_id = ${ctx.companyId} and year = ${p.year} and month = ${p.month}
       and employee_id = any(${employeeIds}::uuid[])`.execute(ctx.trx);
  const decBy = new Map(decs.map((d) => [d.employeeId as string, d]));
  const balances = new Map<string, string>();
  if (policy.leaveTypeId) {
    const { rows } = await sql<Row>`
      select employee_id, balance::text as balance from leave_balances
       where company_id = ${ctx.companyId} and leave_type_id = ${policy.leaveTypeId}
         and employee_id = any(${employeeIds}::uuid[])`.execute(ctx.trx);
    for (const r of rows) balances.set(r.employeeId as string, r.balance as string);
  }
  for (const id of new Set([...byEmp.keys(), ...decBy.keys()])) {
    const calc = computeShortfall(policy, byEmp.get(id) ?? []);
    const dec = decBy.get(id);
    const target = (dec?.target as ShortfallTarget | undefined) ?? policy.defaultTarget;
    const available = balances.get(id) ?? '0.00';
    const split = splitShortfall(calc.daysDue, target, {
      leaveDays: dec?.leaveDays as string | undefined,
      available,
    });
    out.set(id, {
      ...calc,
      employeeId: id,
      target,
      decided: !!dec,
      decisionReason: (dec?.reason as string | undefined) ?? null,
      leaveTypeId: policy.leaveTypeId,
      available,
      ...split,
      suggestAction:
        policy.suggestActionAfter !== null && calc.occurrences >= policy.suggestActionAfter,
    });
  }
  return out;
};

/** بند الراتب الآلي لنقص الدوام (الجزء المخصوم من الراتب فقط) مع تحذير عدم كفاية الرصيد. */
export const shortfallLine = (
  basic: string,
  ev: ShortfallEval | undefined,
): { added: Added; warnings: string[] } => {
  if (!ev) return { added: [], warnings: [] };
  const warnings = ev.balanceShort ? ['SHORTFALL_BALANCE_INSUFFICIENT'] : [];
  if (num(ev.daysSalary).lte(0)) return { added: [], warnings };
  const daily = num(basic).div(SHORTFALL_DAY_BASE);
  const amount = daily.times(ev.daysSalary).toDecimalPlaces(4, 4);
  if (amount.lte(0)) return { added: [], warnings };
  return {
    added: [
      {
        code: SHORTFALL_CODE,
        nameAr: 'خصم نقص الدوام (تأخير ومغادرة مبكرة)',
        nameEn: 'Shortfall deduction (late and early leave)',
        kind: 'deduction',
        amount: amount.toFixed(4),
        auto: {
          explain: {
            type: 'shortfall',
            lateMinutes: ev.lateMinutes,
            earlyMinutes: ev.earlyMinutes,
            occurrences: ev.occurrences,
            chargeableMinutes: ev.chargeableMinutes,
            daysDue: ev.daysDue,
            target: ev.target,
            daysLeave: ev.daysLeave,
            daysSalary: ev.daysSalary,
            dailyRate: daily.toFixed(4),
            dayBase: SHORTFALL_DAY_BASE,
          },
        },
      },
    ],
    warnings,
  };
};

/** يحفظ نتيجة النقص مع القسيمة (أو يمسحها) لقراءتها عند القفل وإعادة الفتح. */
export const persistShortfall = async (
  ctx: Ctx,
  payslipId: string,
  employeeId: string,
  ev: ShortfallEval | undefined,
): Promise<void> => {
  await sql`delete from payslip_shortfalls where payslip_id = ${payslipId} and applied_at is null`.execute(
    ctx.trx,
  );
  if (!ev || num(ev.daysDue).lte(0)) return;
  await sql`
    insert into payslip_shortfalls (payslip_id, company_id, employee_id, leave_type_id, late_minutes, early_minutes,
                                    occurrences, chargeable_minutes, days_due, days_leave, days_salary, target)
    values (${payslipId}, ${ctx.companyId}, ${employeeId}, ${ev.leaveTypeId}, ${ev.lateMinutes}, ${ev.earlyMinutes},
            ${ev.occurrences}, ${ev.chargeableMinutes}, ${ev.daysDue}, ${ev.daysLeave}, ${ev.daysSalary}, ${ev.target})
    on conflict (payslip_id) do nothing`.execute(ctx.trx);
};

/** عند قفل الدورة: يُخصم من رصيد الإجازات ما حُسب لكل قسيمة (مرة واحدة). */
export const applyShortfallOnLock = async (
  ctx: Ctx,
  p: { id: string; year: number; month: number },
): Promise<void> => {
  const { rows } = await sql<Row>`
    select ps.payslip_id, ps.employee_id, ps.leave_type_id, ps.days_leave::text as days_leave
      from payslip_shortfalls ps join payslips s on s.id = ps.payslip_id
     where s.period_id = ${p.id} and s.status = 'calculated' and ps.applied_at is null
       and ps.days_leave > 0 and ps.leave_type_id is not null`.execute(ctx.trx);
  for (const r of rows) {
    try {
      await debit(ctx, {
        employeeId: r.employeeId as string,
        leaveTypeId: r.leaveTypeId as string,
        days: Number(r.daysLeave),
        date: `${p.year}-${String(p.month).padStart(2, '0')}-01`,
        reason: `خصم نقص الدوام ${p.year}-${String(p.month).padStart(2, '0')}`,
        userId: ctx.userId ?? null,
        maxNegative: 0,
        entryType: 'adjustment',
      });
    } catch (e) {
      if (e instanceof AppError && e.code === 'INSUFFICIENT_BALANCE')
        throw new AppError(
          'SHORTFALL_BALANCE_CHANGED',
          409,
          'تغيّر رصيد إجازات موظف منذ الاحتساب؛ أعد احتساب الدورة قبل القفل',
        );
      throw e;
    }
    await sql`update payslip_shortfalls set applied_at = now() where payslip_id = ${r.payslipId as string}`.execute(
      ctx.trx,
    );
  }
};

/** عند إعادة فتح دورة مقفلة: يُعاد إلى الرصيد ما خُصم منه. */
export const revertShortfallOnReopen = async (
  ctx: Ctx,
  p: { id: string; year: number; month: number },
): Promise<void> => {
  const { rows } = await sql<Row>`
    select ps.payslip_id, ps.employee_id, ps.leave_type_id, ps.days_leave::text as days_leave
      from payslip_shortfalls ps join payslips s on s.id = ps.payslip_id
     where s.period_id = ${p.id} and ps.applied_at is not null and ps.leave_type_id is not null`.execute(
    ctx.trx,
  );
  for (const r of rows) {
    await adjust(ctx, {
      employeeId: r.employeeId as string,
      leaveTypeId: r.leaveTypeId as string,
      days: Number(r.daysLeave),
      reason: `إعادة رصيد نقص الدوام لإعادة فتح الدورة ${p.year}-${String(p.month).padStart(2, '0')}`,
      userId: ctx.userId ?? null,
    });
    await sql`update payslip_shortfalls set applied_at = null where payslip_id = ${r.payslipId as string}`.execute(
      ctx.trx,
    );
  }
};
