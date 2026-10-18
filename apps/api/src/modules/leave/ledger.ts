import { sql } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { resolvePolicy } from './assignments.js';
import { allocateFifo, carryOver, dueAccruals, fromCents, toCents, type Lot } from './engine.js';

type EntryType = 'accrual' | 'carry_over' | 'adjustment' | 'consumption' | 'restore' | 'expiry';

export type LotRow = {
  id: string;
  entryType: 'accrual' | 'carry_over' | 'adjustment';
  days: string;
  remaining: string;
  effectiveDate: string;
  expiresOn: string | null;
};

const todayOf = async (ctx: Ctx): Promise<string> =>
  (await sql<{ d: string }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx))
    .rows[0]?.d as string;

/** الدفعات (استحقاق/ترحيل/تعديل موجب) مع المتبقي؛ الأقدم أولاً. */
export const loadLots = async (
  ctx: Ctx,
  employeeId: string,
  leaveTypeId: string,
  openOnly = true,
): Promise<LotRow[]> => {
  const { rows } = await sql<LotRow>`
    select l.id, l.entry_type as "entryType", l.days::text as days,
           l.effective_date::text as "effectiveDate", l.expires_on::text as "expiresOn",
           (l.days + coalesce((select sum(c.days) from leave_ledger c where c.source_entry_id = l.id), 0))::text as remaining
      from leave_ledger l
     where l.company_id = ${ctx.companyId} and l.employee_id = ${employeeId}
       and l.leave_type_id = ${leaveTypeId}
       and l.source_entry_id is null and l.days > 0
       and l.entry_type in ('accrual', 'carry_over', 'adjustment')
     order by l.effective_date,
              case l.entry_type when 'carry_over' then 0 when 'accrual' then 1 else 2 end,
              l.id`.execute(ctx.trx);
  return openOnly ? rows.filter((r) => toCents(r.remaining) > 0) : rows;
};

/** يضمن وجود صف الرصيد ويقفله لتسلسل العمليات المتزامنة على الموظف والنوع. */
const lockBalance = async (ctx: Ctx, employeeId: string, leaveTypeId: string): Promise<number> => {
  await sql`
    insert into leave_balances (company_id, employee_id, leave_type_id, balance)
    values (${ctx.companyId}, ${employeeId}, ${leaveTypeId}, 0)
    on conflict (company_id, employee_id, leave_type_id) do nothing`.execute(ctx.trx);
  const { rows } = await sql<{ balance: string }>`
    select balance::text as balance from leave_balances
     where company_id = ${ctx.companyId} and employee_id = ${employeeId} and leave_type_id = ${leaveTypeId}
       for update`.execute(ctx.trx);
  return toCents(rows[0]?.balance ?? 0);
};

type NewEntry = {
  employeeId: string;
  leaveTypeId: string;
  entryType: EntryType;
  cents: number;
  effectiveDate: string;
  expiresOn?: string | null;
  sourceEntryId?: string | null;
  reversesEntryId?: string | null;
  period?: string | null;
  requestId?: string | null;
  reason?: string | null;
  userId?: string | null;
};

const insertEntry = async (ctx: Ctx, e: NewEntry): Promise<string> => {
  const row = await ctx.trx
    .insertInto('leaveLedger')
    .values({
      companyId: ctx.companyId,
      employeeId: e.employeeId,
      leaveTypeId: e.leaveTypeId,
      entryType: e.entryType,
      days: fromCents(e.cents),
      effectiveDate: e.effectiveDate,
      expiresOn: e.expiresOn ?? null,
      sourceEntryId: e.sourceEntryId ?? null,
      reversesEntryId: e.reversesEntryId ?? null,
      period: e.period ?? null,
      requestId: e.requestId ?? null,
      reason: e.reason ?? null,
      createdBy: e.userId ?? null,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  return row.id;
};

const toLots = (rows: LotRow[]): Lot[] =>
  rows.map((r) => ({
    id: r.id,
    remainingCents: toCents(r.remaining),
    effectiveDate: r.effectiveDate,
    expiresOn: r.expiresOn,
  }));

export type DebitInput = {
  employeeId: string;
  leaveTypeId: string;
  days: number;
  /** تاريخ الاستهلاك (يحدد صلاحية الدفعات) */
  date: string;
  requestId?: string | null;
  reason?: string | null;
  userId?: string | null;
  /** أقصى رصيد سالب مسموح (أيام)؛ Infinity لتجاوز الموارد البشرية */
  maxNegative?: number;
  entryType?: 'consumption' | 'adjustment';
};

/** يخصم أياماً FIFO من الدفعات؛ النقص يُسجَّل قيداً بلا مصدر (رصيد سالب) إن سمحت السياسة. */
export const debit = async (ctx: Ctx, input: DebitInput) => {
  const cents = toCents(input.days);
  if (cents <= 0) throw new AppError('INVALID_DAYS', 400, 'عدد الأيام يجب أن يكون موجباً');
  const balance = await lockBalance(ctx, input.employeeId, input.leaveTypeId);
  const open = await loadLots(ctx, input.employeeId, input.leaveTypeId);
  const { allocations, shortfallCents } = allocateFifo(toLots(open), cents, input.date);
  if (shortfallCents > 0) {
    // دفعات منتهية بالتاريخ ولم تُصفَّ بعد لا تُحتسب متاحة
    const unusable = toLots(open)
      .filter((l) => l.expiresOn && l.expiresOn <= input.date)
      .reduce((s, l) => s + l.remainingCents, 0);
    const available = balance - unusable;
    const maxNeg = input.maxNegative ?? 0;
    if (Number.isFinite(maxNeg) && available - cents < -toCents(maxNeg)) {
      throw new AppError(
        'INSUFFICIENT_BALANCE',
        409,
        `الرصيد غير كافٍ: المتاح ${fromCents(Math.max(available, 0))} والمطلوب ${fromCents(cents)}`,
      );
    }
  }
  const entryType = input.entryType ?? 'consumption';
  const base = {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    entryType,
    effectiveDate: input.date,
    requestId: input.requestId ?? null,
    reason: input.reason ?? null,
    userId: input.userId ?? null,
  } as const;
  for (const a of allocations)
    await insertEntry(ctx, { ...base, cents: -a.cents, sourceEntryId: a.lotId });
  if (shortfallCents > 0) await insertEntry(ctx, { ...base, cents: -shortfallCents });
  return { allocated: allocations.length, shortfallDays: fromCents(shortfallCents) };
};

/** يعيد ما استُهلك لطلب (رفض/إلغاء): دفعات منتهية بعد الاستهلاك لا تُبعث من جديد. */
export const restore = async (
  ctx: Ctx,
  requestId: string,
  userId: string | null,
): Promise<{ restoredDays: string }> => {
  const { rows } = await sql<{
    id: string;
    employeeId: string;
    leaveTypeId: string;
    days: string;
    sourceEntryId: string | null;
    expired: boolean;
  }>`
    select c.id, c.employee_id as "employeeId", c.leave_type_id as "leaveTypeId",
           c.days::text as days, c.source_entry_id as "sourceEntryId",
           exists (select 1 from leave_ledger x where x.entry_type = 'expiry' and x.source_entry_id = c.source_entry_id) as expired
      from leave_ledger c
     where c.company_id = ${ctx.companyId} and c.request_id = ${requestId}
       and c.entry_type = 'consumption'
       and not exists (select 1 from leave_ledger r where r.reverses_entry_id = c.id)
     order by c.created_at, c.id`.execute(ctx.trx);
  if (!rows.length) return { restoredDays: '0.00' };
  const today = await todayOf(ctx);
  let total = 0;
  for (const r of rows) {
    await lockBalance(ctx, r.employeeId, r.leaveTypeId);
    if (r.sourceEntryId && r.expired) continue;
    const cents = -toCents(r.days);
    await insertEntry(ctx, {
      employeeId: r.employeeId,
      leaveTypeId: r.leaveTypeId,
      entryType: 'restore',
      cents,
      effectiveDate: today,
      sourceEntryId: r.sourceEntryId,
      reversesEntryId: r.id,
      requestId,
      userId,
    });
    total += cents;
  }
  return { restoredDays: fromCents(total) };
};

export type AdjustInput = {
  employeeId: string;
  leaveTypeId: string;
  days: number;
  reason: string;
  date?: string;
  expiresOn?: string | null;
  userId: string | null;
};

/** تعديل يدوي: موجب = دفعة جديدة، سالب = خصم FIFO (بلا حد للرصيد السالب). */
export const adjust = async (ctx: Ctx, input: AdjustInput) => {
  const cents = toCents(input.days);
  if (cents === 0) throw new AppError('INVALID_DAYS', 400, 'التعديل لا يمكن أن يكون صفراً');
  const date = input.date ?? (await todayOf(ctx));
  if (cents > 0) {
    await lockBalance(ctx, input.employeeId, input.leaveTypeId);
    await insertEntry(ctx, {
      employeeId: input.employeeId,
      leaveTypeId: input.leaveTypeId,
      entryType: 'adjustment',
      cents,
      effectiveDate: date,
      expiresOn: input.expiresOn ?? null,
      reason: input.reason,
      userId: input.userId,
    });
    return;
  }
  await debit(ctx, {
    employeeId: input.employeeId,
    leaveTypeId: input.leaveTypeId,
    days: -input.days,
    date,
    reason: input.reason,
    userId: input.userId,
    maxNegative: Number.POSITIVE_INFINITY,
    entryType: 'adjustment',
  });
};

// ───────────── الاستحقاق والترحيل والانتهاء الدوري ─────────────
export type MaintenanceResult = {
  employees: number;
  accruals: number;
  carryOvers: number;
  expiries: number;
};

type PolicyRow = {
  id: string;
  annualEntitlement: string;
  accrualMethod: 'monthly' | 'upfront';
  carryOverMax: string;
  carryOverValidMonths: number | null;
  minServiceMonths: number;
};

/** todayOverride للاختبار فقط (الإنتاج: تاريخ الشركة المحلي). */
export const runLeaveMaintenance = async (
  ctx: Ctx,
  todayOverride?: string,
): Promise<MaintenanceResult> => {
  const today = todayOverride ?? (await todayOf(ctx));
  const year = Number(today.slice(0, 4));
  const yearStart = `${year}-01-01`;
  const result: MaintenanceResult = { employees: 0, accruals: 0, carryOvers: 0, expiries: 0 };

  const types = await ctx.trx
    .selectFrom('leaveTypes')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('isActive', '=', true)
    .execute();
  const policies = new Map<string, PolicyRow>(
    (
      await ctx.trx
        .selectFrom('leavePolicies')
        .select([
          'id',
          'annualEntitlement',
          'accrualMethod',
          'carryOverMax',
          'carryOverValidMonths',
          'minServiceMonths',
        ])
        .where('companyId', '=', ctx.companyId)
        .execute()
    ).map((p) => [p.id, p as PolicyRow]),
  );
  const employees = await ctx.trx
    .selectFrom('employees')
    .select(['id', 'firstHireDate'])
    .where('companyId', '=', ctx.companyId)
    .where('status', '<>', 'terminated')
    .where('firstHireDate', 'is not', null)
    .execute();

  for (const emp of employees) {
    const hire = emp.firstHireDate as string;
    let touched = false;
    for (const type of types) {
      const resolved = await resolvePolicy(ctx, emp.id, type.id, today);
      const policy = resolved ? policies.get(resolved.policyId) : undefined;
      if (!policy) continue;
      touched = true;
      await lockBalance(ctx, emp.id, type.id);

      // 1) مطلع السنة: انتهاء ما بقي من السنوات السابقة وترحيل حتى السقف
      const hasCarry = (
        await sql<{ n: string }>`
          select count(*)::text as n from leave_ledger
           where company_id = ${ctx.companyId} and employee_id = ${emp.id} and leave_type_id = ${type.id}
             and entry_type = 'carry_over' and period = ${String(year)}`.execute(ctx.trx)
      ).rows[0]?.n;
      if (hasCarry === '0') {
        const old = (await loadLots(ctx, emp.id, type.id)).filter(
          (l) => l.effectiveDate < yearStart,
        );
        if (old.length) {
          const carryable = old
            .filter((l) => l.entryType !== 'carry_over')
            .reduce((s, l) => s + toCents(l.remaining), 0);
          const { carryCents, expiresOn } = carryOver(carryable, policy, year);
          for (const l of old) {
            await insertEntry(ctx, {
              employeeId: emp.id,
              leaveTypeId: type.id,
              entryType: 'expiry',
              cents: -toCents(l.remaining),
              effectiveDate: yearStart,
              sourceEntryId: l.id,
              reason: 'year_end',
            });
            result.expiries += 1;
          }
          if (carryCents > 0) {
            await insertEntry(ctx, {
              employeeId: emp.id,
              leaveTypeId: type.id,
              entryType: 'carry_over',
              cents: carryCents,
              effectiveDate: yearStart,
              expiresOn,
              period: String(year),
            });
            result.carryOvers += 1;
          }
        }
      }

      // 2) انتهاء الدفعات ذات الصلاحية (المرحَّل)
      for (const l of await loadLots(ctx, emp.id, type.id)) {
        if (l.expiresOn && l.expiresOn <= today) {
          await insertEntry(ctx, {
            employeeId: emp.id,
            leaveTypeId: type.id,
            entryType: 'expiry',
            cents: -toCents(l.remaining),
            effectiveDate: l.expiresOn,
            sourceEntryId: l.id,
            reason: 'validity',
          });
          result.expiries += 1;
        }
      }

      // 3) الاستحقاق (يعوّض الأشهر الفائتة؛ المفتاح الفريد يمنع التكرار)
      for (const due of dueAccruals(policy, hire, today)) {
        const r = await sql`
          insert into leave_ledger (company_id, employee_id, leave_type_id, entry_type, days, effective_date, period, reason)
          values (${ctx.companyId}, ${emp.id}, ${type.id}, 'accrual', ${fromCents(due.cents)}, ${due.effectiveDate}, ${due.period}, 'accrual')
          on conflict (company_id, employee_id, leave_type_id, entry_type, period)
            where period is not null and entry_type in ('accrual', 'carry_over') do nothing`.execute(
          ctx.trx,
        );
        if (Number(r.numAffectedRows ?? 0) > 0) result.accruals += 1;
      }
    }
    if (touched) result.employees += 1;
  }
  return result;
};

// ───────────── القراءة ─────────────
export type BalanceDto = {
  leaveTypeId: string;
  balance: string;
  lots: LotRow[];
};

/** رصيد الموظف لكل نوع فعّال مع الدفعات المفتوحة. */
export const balancesOf = async (ctx: Ctx, employeeId: string): Promise<BalanceDto[]> => {
  const types = await ctx.trx
    .selectFrom('leaveTypes')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('isActive', '=', true)
    .orderBy('code')
    .execute();
  const bal = new Map(
    (
      await ctx.trx
        .selectFrom('leaveBalances')
        .select(['leaveTypeId', 'balance'])
        .where('companyId', '=', ctx.companyId)
        .where('employeeId', '=', employeeId)
        .execute()
    ).map((b) => [b.leaveTypeId, b.balance]),
  );
  const out: BalanceDto[] = [];
  for (const t of types)
    out.push({
      leaveTypeId: t.id,
      balance: bal.get(t.id) ?? '0.00',
      lots: await loadLots(ctx, employeeId, t.id),
    });
  return out;
};
