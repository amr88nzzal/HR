import { sql } from 'kysely';
import { buildSchedule, num } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

type Row = Record<string, unknown>;

export type LoanTypeRow = {
  id: string;
  code: string;
  disburses: boolean;
  maxInstallments: number;
  monthlyLimitPercent: string | null;
  isActive: boolean;
};

const DEFAULTS = [
  ['loan', 'قرض', 'Loan', '#4c6ef5', true, 60, 1],
  ['advance', 'سلفة', 'Advance', '#fd7e14', true, 12, 2],
  ['receivable', 'فاتورة ذمم', 'Receivable invoice', '#12b886', false, 12, 3],
] as const;

/**
 * يزرع الأنواع الافتراضية للشركات الجديدة (تُنشأ بلا هجرة) عند أول استخدام.
 * Seeds the default types for new companies (created without a migration) on first use.
 */
export const ensureDefaultLoanTypes = async (ctx: Ctx): Promise<void> => {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n from loan_types where company_id = ${ctx.companyId}`.execute(ctx.trx);
  if (rows[0]!.n > 0) return;
  for (const [code, ar, en, color, disburses, max, ord] of DEFAULTS)
    await sql`insert into loan_types (company_id, code, name_ar, name_en, color, disburses, max_installments, sort_order)
              values (${ctx.companyId}, ${code}, ${ar}, ${en}, ${color}, ${disburses}, ${max}, ${ord})
              on conflict (company_id, code) do nothing`.execute(ctx.trx);
};

/** يحلّ النوع بالمعرّف أو الرمز ويرفض غير الموجود/المعطّل. / Resolves a type by id or code; rejects missing/inactive. */
export const resolveLoanType = async (
  ctx: Ctx,
  ref: { typeId?: string | undefined; kind?: string | undefined },
): Promise<LoanTypeRow> => {
  await ensureDefaultLoanTypes(ctx);
  const { rows } = await sql<Row>`
    select id, code, disburses, max_installments, monthly_limit_percent::text as monthly_limit_percent, is_active
      from loan_types
     where company_id = ${ctx.companyId}
       and ${ref.typeId ? sql`id = ${ref.typeId}` : sql`code = ${ref.kind ?? 'loan'}`}`.execute(
    ctx.trx,
  );
  const r = rows[0];
  if (!r) throw new AppError('NOT_FOUND', 404, 'نوع السلفة غير موجود');
  if (!r['isActive']) throw new AppError('TYPE_INACTIVE', 409, 'نوع السلفة معطّل');
  return r as unknown as LoanTypeRow;
};

export type EventPlan = {
  eventDate: string;
  firstYear: number;
  firstMonth: number;
};

/** تاريخ الحدث (الافتراضي اليوم) وأول شهر خصم (الافتراضي شهر الحدث). / Event date (default today) and first deduction month (default event month). */
export const planDates = (b: {
  eventDate?: string | undefined;
  firstYear?: number | undefined;
  firstMonth?: number | undefined;
}): EventPlan => {
  const eventDate = b.eventDate ?? new Date().toISOString().slice(0, 10);
  return {
    eventDate,
    firstYear: b.firstYear ?? Number(eventDate.slice(0, 4)),
    firstMonth: b.firstMonth ?? Number(eventDate.slice(5, 7)),
  };
};

/**
 * تنبيه (لا منع): أقساط الموظف في شهر أول خصم تتجاوز نسبة الحد من أساسي الراتب.
 * Warning only: the employee's installments in the first deduction month exceed the type's % of basic salary.
 */
export const monthlyLimitWarning = async (
  ctx: Ctx,
  type: LoanTypeRow,
  employeeId: string,
  principal: string,
  count: number,
  year: number,
  month: number,
): Promise<string | null> => {
  if (!type.monthlyLimitPercent) return null;
  const first = buildSchedule(principal, count, year, month)[0]!.amount;
  const { rows } = await sql<Row>`
    select (select basic_amount from employee_salaries s
             where s.employee_id = ${employeeId} and s.valid_from <= company_today(${ctx.companyId})
               and (s.valid_to is null or s.valid_to >= company_today(${ctx.companyId}))
             order by s.valid_from desc limit 1)::text as basic,
           coalesce((select sum(i.amount) from loan_installments i join loans l on l.id = i.loan_id
                      where l.employee_id = ${employeeId} and l.status = 'active'
                        and i.status = 'scheduled' and i.due_year = ${year} and i.due_month = ${month}), 0)::text as existing`.execute(
    ctx.trx,
  );
  const basic = rows[0]?.['basic'] as string | null | undefined;
  if (!basic || num(basic).lte(0)) return null;
  const limit = num(basic).mul(type.monthlyLimitPercent).div(100);
  const total = num(first).plus(num(rows[0]!['existing'] as string));
  return total.gt(limit) ? 'MONTHLY_LIMIT_EXCEEDED' : null;
};
