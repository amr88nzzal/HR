import { sql } from 'kysely';
import { num, planDefer, SETTING_DEFS } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';

type Row = Record<string, unknown>;

export type DueInstallment = {
  id: string;
  loanId: string;
  no: number;
  dueYear: number;
  dueMonth: number;
  amount: string;
};
export type LoanItem = { installmentId: string; loanId: string; amount: string; overCap: boolean };

/** سقف الاستقطاع: نسبة % من الصافي (الإعداد loanMaxNetPercent). */
export const loadCapPercent = async (ctx: Ctx): Promise<number> => {
  const row = await ctx.trx
    .selectFrom('settings')
    .select('value')
    .where('companyId', '=', ctx.companyId)
    .where('scopeType', '=', 'company')
    .where('key', '=', 'loanMaxNetPercent')
    .executeTakeFirst();
  const r = SETTING_DEFS.loanMaxNetPercent.schema.safeParse(row?.value);
  return r.success ? r.data : SETTING_DEFS.loanMaxNetPercent.default;
};

/**
 * يوزّع الأقساط المستحقة على الصافي: الأقدم أولاً حتى سقف النسبة؛ أول قسط لا يتسع يوقف الخصم
 * وما بعده يُرحَّل (overCap). نقية بلا قاعدة بيانات.
 */
export const allocateInstallments = (
  net: string,
  capPercent: number,
  due: DueInstallment[],
): { items: LoanItem[]; total: string } => {
  const netN = num(net);
  const cap = netN.lte(0) ? num(0) : netN.times(capPercent).div(100).toDecimalPlaces(4, 1);
  let used = num(0);
  let stopped = false;
  const items: LoanItem[] = [];
  for (const d of due) {
    const amt = num(d.amount);
    if (!stopped && used.plus(amt).lte(cap)) {
      used = used.plus(amt);
      items.push({ installmentId: d.id, loanId: d.loanId, amount: d.amount, overCap: false });
    } else {
      stopped = true;
      items.push({ installmentId: d.id, loanId: d.loanId, amount: d.amount, overCap: true });
    }
  }
  return { items, total: used.toFixed(4) };
};

/** الأقساط المستحقة (حتى شهر الدورة) لسلف نشطة بعملة الدورة، مجمّعة بالموظف. */
export const loadDueInstallments = async (
  ctx: Ctx,
  year: number,
  month: number,
  currency: string,
  employeeIds: string[],
): Promise<Map<string, DueInstallment[]>> => {
  const out = new Map<string, DueInstallment[]>();
  if (!employeeIds.length) return out;
  const { rows } = await sql<Row>`
    select l.employee_id, i.id, i.loan_id, i.no, i.due_year, i.due_month, i.amount::text as amount
      from loan_installments i join loans l on l.id = i.loan_id
     where i.company_id = ${ctx.companyId} and l.status = 'active' and i.status = 'scheduled'
       and l.currency = ${currency} and l.employee_id = any(${employeeIds}::uuid[])
       and (i.due_year * 12 + i.due_month) <= ${year * 12 + month}
     order by i.due_year, i.due_month, l.created_at, i.no`.execute(ctx.trx);
  for (const r of rows) {
    const list = out.get(r.employeeId as string) ?? [];
    list.push({
      id: r.id as string,
      loanId: r.loanId as string,
      no: Number(r.no),
      dueYear: Number(r.dueYear),
      dueMonth: Number(r.dueMonth),
      amount: r.amount as string,
    });
    out.set(r.employeeId as string, list);
  }
  return out;
};

/**
 * تأجيل قسط وفق `planDefer` المشتركة مع الواجهة: يُلحَق المبلغ المؤجَّل بأقساط جديدة من شهر محدد
 * (افتراضياً بعد آخر قسط) أو يُوزَّع على الأقساط المتبقية. التأجيل الجزئي يُبقي القسط مجدولاً بالباقي.
 * يعيد معرّف أول قسط جديد (أو null عند التوزيع على القائمة).
 */
export const deferInstallment = async (
  ctx: Ctx,
  installmentId: string,
  opts: {
    reason: string;
    periodId?: string | null;
    system?: boolean;
    amount?: string | undefined;
    mode?: 'month' | 'remaining' | undefined;
    count?: number | undefined;
    target?: { year: number; month: number } | undefined;
  },
): Promise<string | null> => {
  const { rows } = await sql<Row>`
    select i.id, i.loan_id, i.no, i.amount::text as amount, i.status, i.due_year, i.due_month
      from loan_installments i
     where i.id = ${installmentId} and i.company_id = ${ctx.companyId} for update`.execute(ctx.trx);
  const inst = rows[0];
  if (!inst) throw new AppError('NOT_FOUND', 404, 'القسط غير موجود');
  if (inst.status !== 'scheduled')
    throw new AppError('INSTALLMENT_NOT_SCHEDULED', 409, 'يؤجَّل القسط المجدول فقط');
  const loanId = inst.loanId as string;
  const dueYear = Number(inst.dueYear);
  const dueMonth = Number(inst.dueMonth);
  const { rows: last } = await sql<Row>`
    select max(no) as no, max(due_year * 12 + due_month) as ym from loan_installments
     where loan_id = ${loanId} and status <> 'cancelled'`.execute(ctx.trx);
  const mode = opts.mode ?? 'month';
  let target = opts.target;
  if (mode === 'month' && !target) {
    const next = Number(last[0]!.ym) + 1; // الترميز: سنة*12+شهر
    target = { year: Math.floor((next - 1) / 12), month: ((next - 1) % 12) + 1 };
  }
  const { rows: rem } = await sql<Row>`
    select id, due_year, due_month, amount::text as amount from loan_installments
     where loan_id = ${loanId} and status = 'scheduled' and id <> ${installmentId}
       and (due_year * 12 + due_month) > ${dueYear * 12 + dueMonth}
     order by due_year, due_month, no`.execute(ctx.trx);
  const plan = planDefer({
    amount: inst.amount as string,
    deferAmount: opts.amount,
    dueYear,
    dueMonth,
    mode,
    targetYear: target?.year,
    targetMonth: target?.month,
    count: opts.count,
    remaining: rem.map((r) => ({
      id: r.id as string,
      year: Number(r.dueYear),
      month: Number(r.dueMonth),
      amount: r.amount as string,
    })),
  });
  if (!plan.ok) {
    const msg = {
      INVALID_DEFER_AMOUNT: 'المبلغ المؤجَّل يجب أن يكون أكبر من صفر ولا يتجاوز القسط',
      INVALID_TARGET_MONTH: 'شهر التأجيل يجب أن يلي شهر استحقاق القسط',
      NO_REMAINING: 'لا أقساط متبقية للتوزيع عليها',
      INVALID_COUNT: 'عدد الأقساط أكبر من المتبقي',
    }[plan.code];
    throw new AppError(plan.code, 400, msg);
  }
  let no = Number(last[0]!.no);
  let firstNew: string | null = null;
  for (const r of plan.rows) {
    if (r.id) {
      await sql`update loan_installments set amount = ${r.total}::numeric where id = ${r.id}`.execute(
        ctx.trx,
      );
    } else {
      const { rows: ins } = await sql<{ id: string }>`
        insert into loan_installments (company_id, loan_id, no, due_year, due_month, amount, deferred_reason)
        values (${ctx.companyId}, ${loanId}, ${++no}, ${r.year}, ${r.month}, ${r.add}::numeric,
                ${plan.full ? null : opts.reason})
        returning id`.execute(ctx.trx);
      firstNew ??= ins[0]!.id;
    }
  }
  if (plan.full) {
    await sql`
      update loan_installments set status = 'deferred', deferred_reason = ${opts.reason},
             system_deferred = ${opts.system ?? false}, period_id = ${opts.periodId ?? null},
             moved_to_id = ${firstNew}
       where id = ${installmentId}`.execute(ctx.trx);
  } else {
    await sql`
      update loan_installments set amount = ${plan.keep}::numeric,
             deferred_reason = ${mode === 'remaining' ? opts.reason : null}
       where id = ${installmentId}`.execute(ctx.trx);
  }
  return firstNew;
};

/** تُغلق السلف التي لم يبق لها قسط مجدول، وتُعاد فتح ما رجع إليه قسط مجدول. */
export const refreshLoanStatuses = async (ctx: Ctx, loanIds?: string[]): Promise<void> => {
  const scope = loanIds ? sql`and l.id = any(${loanIds}::uuid[])` : sql``;
  await sql`
    update loans l set status = 'settled'
     where l.company_id = ${ctx.companyId} and l.status = 'active' ${scope}
       and not exists (select 1 from loan_installments i where i.loan_id = l.id and i.status = 'scheduled')`.execute(
    ctx.trx,
  );
  await sql`
    update loans l set status = 'active'
     where l.company_id = ${ctx.companyId} and l.status = 'settled' ${scope}
       and exists (select 1 from loan_installments i where i.loan_id = l.id and i.status = 'scheduled')`.execute(
    ctx.trx,
  );
};

/** عند قفل الدورة: تثبيت الأقساط المخصومة وترحيل ما تجاوز السقف. */
export const applyLoansOnLock = async (ctx: Ctx, periodId: string): Promise<void> => {
  const { rows } = await sql<Row>`
    select it.installment_id, it.payslip_id, it.over_cap, li.loan_id
      from payslip_loan_items it
      join payslips s on s.id = it.payslip_id
      join loan_installments li on li.id = it.installment_id
     where s.period_id = ${periodId}`.execute(ctx.trx);
  const loans = new Set<string>();
  for (const r of rows) {
    loans.add(r.loanId as string);
    if (r.overCap) {
      await deferInstallment(ctx, r.installmentId as string, {
        reason: 'insufficient_net',
        periodId,
        system: true,
      });
    } else {
      await sql`update loan_installments set status = 'deducted', period_id = ${periodId},
                       payslip_id = ${r.payslipId as string}
                 where id = ${r.installmentId as string} and status = 'scheduled'`.execute(ctx.trx);
    }
  }
  await refreshLoanStatuses(ctx, [...loans]);
};

/** عند إعادة فتح دورة مقفلة: يعاد كل قسط خُصم أو رُحِّل تلقائياً فيها إلى «مجدول». */
export const revertLoansOnReopen = async (ctx: Ctx, periodId: string): Promise<void> => {
  const { rows } = await sql<Row>`
    select id, loan_id, status, moved_to_id from loan_installments
     where period_id = ${periodId} and (status = 'deducted' or (status = 'deferred' and system_deferred))
     for update`.execute(ctx.trx);
  const loans = new Set<string>();
  for (const r of rows) {
    loans.add(r.loanId as string);
    if (r.status === 'deferred' && r.movedToId) {
      const { rows: t } = await sql<Row>`
        select status from loan_installments where id = ${r.movedToId as string}`.execute(ctx.trx);
      if (t[0] && t[0].status !== 'scheduled')
        throw new AppError(
          'LOAN_ALREADY_PROGRESSED',
          409,
          'رُحِّل قسط من هذه الدورة وخُصم لاحقاً؛ أعد فتح الدورات الأحدث أولاً',
        );
      await sql`update loan_installments set moved_to_id = null where id = ${r.id as string}`.execute(
        ctx.trx,
      );
      await sql`delete from loan_installments where id = ${r.movedToId as string}`.execute(ctx.trx);
    }
    await sql`update loan_installments set status = 'scheduled', period_id = null, payslip_id = null,
                     deferred_reason = null, system_deferred = false
               where id = ${r.id as string}`.execute(ctx.trx);
  }
  await refreshLoanStatuses(ctx, [...loans]);
};
