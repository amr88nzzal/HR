import { sql } from 'kysely';
import { buildSchedule } from '@hrms/shared';
import { withTenant, type Ctx } from '../db/tenant.js';
import type { Db } from '../db/index.js';
import { createApprovalEngine } from '../approvals/index.js';
import { recomputeDays } from '../modules/attendance/index.js';
import { submitRequest } from '../modules/leave/index.js';
import { calculatePeriod, monthRange } from '../modules/payroll/calc.js';
import { applyLoansOnLock } from '../modules/payroll/loans.js';
import { ensureDefaultGroup } from '../modules/payroll/runs.routes.js';
import { createNotifier } from '../notifications/index.js';
import { DEMO_EMAIL_DOMAIN, DEMO_PREFIX } from './demo.js';

/**
 * طبقة «تاريخ ستة أشهر»: تملأ ما قبل الأسبوعين الأخيرين ببصمات وإجازات ورواتب مقفلة وسلفة مسدَّدة،
 * فتظهر التقارير والرسوم والكشوف بعمق زمني حقيقي. كل جزء له علامة فيُعاد تشغيله بأمان.
 */
export type HistoryPart =
  'historyLeave' | 'historyAttendance' | 'historyPayroll' | 'historyShortfall';

const HISTORY_DAYS = 182;
const NOTE = 'DEMO-HIST';

const pad = (n: number, w = 2) => String(n).padStart(w, '0');
const isoDay = (offset: number): string =>
  new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const weekday = (iso: string): number => new Date(`${iso}T00:00:00Z`).getUTCDay();
const addDays = (iso: string, n: number): string =>
  new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const sundayOnOrAfter = (offset: number): string => {
  const d = isoDay(offset);
  return addDays(d, (7 - weekday(d)) % 7);
};
const addMin = (hhmm: string, delta: number): string => {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const t = h * 60 + m + delta;
  return `${pad(Math.floor(t / 60))}:${pad(t % 60)}`;
};

// ───────────────────── إجازات تاريخية (معتمدة/مرفوضة/ملغاة) على مدى ستة أشهر ─────────────────────
const seedHistoryLeave = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('leaveRequests')
    .select('id')
    .where('companyId', '=', companyId)
    .where('reason', 'like', `%${NOTE}%`)
    .limit(1)
    .executeTakeFirst();
  if (marker) return 'skip';
  const types = await trx
    .selectFrom('leaveTypes')
    .select(['id', 'code'])
    .where('companyId', '=', companyId)
    .where('code', 'in', ['DEMO-ANNUAL', 'DEMO-SICK', 'DEMO-UNPAID'])
    .execute();
  const typeId = (code: string) => types.find((t) => t.code === code)?.id;
  const annual = typeId('DEMO-ANNUAL');
  const sick = typeId('DEMO-SICK');
  const unpaid = typeId('DEMO-UNPAID');
  if (!annual || !sick || !unpaid) return 'skip لا أنواع إجازات تجريبية';
  const users = await trx
    .selectFrom('users as u')
    .innerJoin('employees as e', 'e.userId', 'u.id')
    .select(['u.id as userId', 'e.id as employeeId', 'u.email'])
    .where('u.companyId', '=', companyId)
    .where('u.email', 'like', `demo.%@${DEMO_EMAIL_DOMAIN}`)
    .execute();
  const by = (n: string) => users.find((u) => u.email === `demo.${n}@${DEMO_EMAIL_DOMAIN}`);
  const emp = by('employee');
  const mgr = by('manager');
  const hr = by('hr');
  if (!emp || !mgr || !hr) return 'skip مستخدمو التجربة الأساسيون غير موجودين';

  const engine = createApprovalEngine(createNotifier(undefined));
  const decide = async (approvalId: string, action: 'approve' | 'reject', note?: string) => {
    const a = await trx
      .selectFrom('approvalRequestAssignees')
      .select('userId')
      .where('requestId', '=', approvalId)
      .where('status', '=', 'pending')
      .executeTakeFirstOrThrow();
    await engine.act(ctx, approvalId, a.userId, { action, note: note ?? null });
  };
  type Who = { userId: string; employeeId: string };
  const ask = async (who: Who, type: string, start: string, len: number, reason: string) => {
    const id = await submitRequest(ctx, engine, who.userId, who.employeeId, {
      leaveTypeId: type,
      startDate: start,
      endDate: addDays(start, len - 1),
      firstDayHalf: false,
      lastDayHalf: false,
      reason: `${reason} (${NOTE})`,
    });
    const r = await trx
      .selectFrom('leaveRequests')
      .select('approvalRequestId')
      .where('id', '=', id)
      .executeTakeFirstOrThrow();
    return r.approvalRequestId as string;
  };

  // الموظف: سنوية قبل خمسة أشهر، مرضية قبل أربعة، سنوية مرفوضة قبل ثلاثة، بلا راتب قبل أربعة أسابيع
  await decide(await ask(emp, annual, sundayOnOrAfter(-150), 4, 'إجازة عيد'), 'approve');
  await decide(await ask(emp, sick, sundayOnOrAfter(-118), 3, 'التهاب حاد'), 'approve');
  await decide(
    await ask(emp, annual, sundayOnOrAfter(-92), 5, 'سفر'),
    'reject',
    'تزامنها مع إقفال ربع سنوي',
  );
  await decide(await ask(emp, unpaid, sundayOnOrAfter(-63), 2, 'ظرف شخصي'), 'approve');
  // المدير
  await decide(await ask(mgr, annual, sundayOnOrAfter(-135), 6, 'إجازة عائلية'), 'approve');
  await decide(await ask(mgr, annual, sundayOnOrAfter(-70), 3, 'راحة قصيرة'), 'approve');
  // الموارد البشرية
  await decide(await ask(hr, annual, sundayOnOrAfter(-110), 3, 'مناسبة عائلية'), 'approve');
  await decide(await ask(hr, sick, sundayOnOrAfter(-40), 2, 'وعكة'), 'approve');
  return undefined;
};

// ───────────────────── بصمات ستة أشهر ثم الاحتساب ─────────────────────
const seedHistoryAttendance = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const marker = await trx
    .selectFrom('attendanceRecords')
    .select('id')
    .where('companyId', '=', companyId)
    .where('note', '=', NOTE)
    .limit(1)
    .executeTakeFirst();
  if (marker) return 'skip';
  const hasShifts = await trx
    .selectFrom('shifts')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-DAY')
    .executeTakeFirst();
  if (!hasShifts) return 'skip لا جداول حضور';

  const emps = await trx
    .selectFrom('employees as e')
    .leftJoin('employments as m', (j) =>
      j.onRef('m.employeeId', '=', 'e.id').on('m.validTo', 'is', null),
    )
    .leftJoin('departments as d', 'd.id', 'm.departmentId')
    .select(['e.id', 'e.employeeNo', 'd.code as deptCode', 'e.firstHireDate'])
    .where('e.companyId', '=', companyId)
    .where('e.status', '=', 'active')
    .where('e.employeeNo', 'like', `${DEMO_PREFIX}%`)
    .orderBy('e.employeeNo')
    .execute();
  const holidays = new Set(
    (
      await trx
        .selectFrom('holidays')
        .select(sql<string>`holiday_date::text`.as('d'))
        .where('companyId', '=', companyId)
        .execute()
    ).map((h) => h.d),
  );
  const leaves = await trx
    .selectFrom('leaveRequests')
    .select([
      'employeeId',
      sql<string>`start_date::text`.as('s'),
      sql<string>`end_date::text`.as('e'),
    ])
    .where('companyId', '=', companyId)
    .where('status', '=', 'approved')
    .execute();
  const onLeave = (empId: string, d: string) =>
    leaves.some((l) => l.employeeId === empId && l.s <= d && d <= l.e);

  type Row = { employeeId: string; date: string; time: string };
  const rows: Row[] = [];
  emps.forEach((e, i) => {
    const hire = String(e.firstHireDate);
    for (let back = HISTORY_DAYS; back >= 15; back--) {
      const date = isoDay(-back);
      if (weekday(date) > 4) continue; // الجمعة والسبت راحة
      if (holidays.has(date) || date < hire || onLeave(e.id, date)) continue;
      // الموظف الليلي على جدول ليلي في آخر 30 يوماً فقط (يوافق إسناده المؤقت)
      const night = e.employeeNo === `${DEMO_PREFIX}010` && back <= 30;
      const [start, end] = night
        ? ['22:00', '06:00']
        : e.deptCode === 'DEMO-SAL'
          ? ['08:00', '20:00']
          : ['08:00', '16:00'];
      const k = i * 7 + back;
      // أشهر أشدّ تأخراً وغياباً لتتباين الرسوم (كل 5 أشهر تقريباً)
      const bad = Math.floor(back / 30) === 3 ? 3 : 0;
      if (k % (17 - bad) === 0) continue; // غياب
      const late = k % (6 - Math.min(bad, 2)) === 0 ? 22 : (k % 4) - 1;
      const early = k % 13 === 0 ? -35 : (k % 3) - 1;
      rows.push({ employeeId: e.id, date, time: addMin(start, late) });
      rows.push({
        employeeId: e.id,
        date: night ? addDays(date, 1) : date,
        time: addMin(end, early),
      });
    }
  });
  const tz = (
    await trx
      .selectFrom('companies')
      .select('timezone')
      .where('id', '=', companyId)
      .executeTakeFirstOrThrow()
  ).timezone;
  for (let i = 0; i < rows.length; i += 400) {
    const chunk = rows.slice(i, i + 400);
    await sql`insert into attendance_records (company_id, employee_id, punched_at, source, note)
      select ${companyId}, v.employee_id::uuid, ((v.d::date + v.t::time) at time zone ${tz}), 'manual', ${NOTE}
        from (values ${sql.join(
          chunk.map((r) => sql`(${r.employeeId}, ${r.date}, ${r.time})`),
        )}) as v(employee_id, d, t)
      on conflict do nothing`.execute(trx);
  }
  await recomputeDays(ctx, 'all', isoDay(-HISTORY_DAYS), isoDay(-15));
  return `${rows.length} بصمة`;
};

// ───────────────────── رواتب مقفلة لأربعة أشهر + سلفة مسدَّدة + دفعات ─────────────────────
const seedHistoryPayroll = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const draft = await trx
    .selectFrom('payrollPeriods')
    .selectAll()
    .where('companyId', '=', companyId)
    .where('status', '=', 'draft')
    .orderBy('year', 'desc')
    .orderBy('month', 'desc')
    .executeTakeFirst();
  if (!draft) return 'skip لا دورة رواتب تجريبية';
  const monthAt = (back: number) => {
    const d = new Date(Date.UTC(draft.year, draft.month - 1 - back, 1));
    return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 };
  };
  // المسودة = الشهر 0، والمقفلة الموجودة = 1، ونضيف 5..2 فتصير ستة أشهر
  const oldest = monthAt(5);
  const exists = await trx
    .selectFrom('payrollPeriods')
    .select('id')
    .where('companyId', '=', companyId)
    .where('year', '=', oldest.year)
    .where('month', '=', oldest.month)
    .executeTakeFirst();
  if (exists) return 'skip';

  // سلفة/قرض مسدَّد بالكامل خلال الأشهر المقفلة (أربعة أقساط)
  const borrowers = await trx
    .selectFrom('employeeSalaries')
    .select('employeeId')
    .distinct()
    .where('companyId', '=', companyId)
    .where('currency', '=', draft.currency)
    .orderBy('employeeId', 'desc')
    .limit(1)
    .execute();
  if (borrowers[0]) {
    const principal = '800';
    const loan = await trx
      .insertInto('loans')
      .values({
        companyId,
        employeeId: borrowers[0].employeeId,
        kind: 'loan',
        currency: draft.currency,
        principal,
        installmentsCount: 4,
        firstYear: oldest.year,
        firstMonth: oldest.month,
        reason: `${DEMO_PREFIX} قرض مسدَّد (تاريخي)`,
        createdBy: ctx.userId ?? null,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    for (const it of buildSchedule(principal, 4, oldest.year, oldest.month))
      await trx
        .insertInto('loanInstallments')
        .values({
          companyId,
          loanId: loan.id,
          no: it.no,
          dueYear: it.year,
          dueMonth: it.month,
          amount: it.amount,
        })
        .execute();
    await trx
      .insertInto('payments')
      .values({
        companyId,
        kind: 'loan',
        employeeId: borrowers[0].employeeId,
        loanId: loan.id,
        amount: principal,
        currency: draft.currency,
        status: 'paid',
        method: 'bank',
        paidAt: addDays(`${oldest.year}-${pad(oldest.month)}-01`, -2),
      })
      .execute();
  }

  const groupId = draft.payGroupId ?? (await ensureDefaultGroup(ctx));
  let made = 0;
  for (const back of [5, 4, 3, 2]) {
    const { year, month } = monthAt(back);
    const { startDate, endDate } = monthRange(year, month);
    const period = await trx
      .insertInto('payrollPeriods')
      .values({
        companyId,
        payGroupId: groupId,
        year,
        month,
        startDate,
        endDate,
        currency: draft.currency,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await calculatePeriod(ctx, {
      id: period.id,
      payGroupId: groupId,
      year,
      month,
      startDate,
      endDate,
      currency: draft.currency,
      status: 'draft',
    });
    await sql`update payroll_periods set status = 'approved', approved_at = ${`${endDate}T12:00:00Z`}::timestamptz where id = ${period.id}`.execute(
      trx,
    );
    await sql`
      insert into payments (company_id, kind, employee_id, period_id, payslip_id, amount, currency, status, method, paid_at)
      select s.company_id, 'payslip', s.employee_id, s.period_id, s.id, s.payable_amount, s.currency,
             'paid', 'bank', (${endDate}::date + 3)
        from payslips s where s.period_id = ${period.id} and s.status = 'calculated' and s.payable_amount > 0
      on conflict (payslip_id) where kind = 'payslip' do nothing`.execute(trx);
    await sql`update payroll_periods set status = 'locked', locked_at = ${`${endDate}T18:00:00Z`}::timestamptz where id = ${period.id}`.execute(
      trx,
    );
    await applyLoansOnLock(ctx, period.id);
    made++;
  }

  // دورة الشهر -2 (المقفلة سابقاً بلا دفعات): دفعات نصفها مدفوع ونصفها معلّق
  const prev = monthAt(1);
  const p2 = await trx
    .selectFrom('payrollPeriods')
    .select(['id', 'endDate'])
    .where('companyId', '=', companyId)
    .where('year', '=', prev.year)
    .where('month', '=', prev.month)
    .where('status', '=', 'locked')
    .executeTakeFirst();
  if (p2) {
    await sql`
      insert into payments (company_id, kind, employee_id, period_id, payslip_id, amount, currency)
      select s.company_id, 'payslip', s.employee_id, s.period_id, s.id, s.payable_amount, s.currency
        from payslips s where s.period_id = ${p2.id} and s.status = 'calculated' and s.payable_amount > 0
      on conflict (payslip_id) where kind = 'payslip' do nothing`.execute(trx);
    await sql`update payments set status = 'paid', method = 'bank', paid_at = ${String(p2.endDate)}::date + 3
               where period_id = ${p2.id} and kind = 'payslip'
                 and id in (select id from payments where period_id = ${p2.id} and kind = 'payslip'
                            order by id limit (select count(*) / 2 from payments where period_id = ${p2.id} and kind = 'payslip'))`.execute(
      trx,
    );
  }
  // المسودة تُعاد لتشمل الغياب والتأخير التاريخي الكامل
  await calculatePeriod(ctx, {
    id: draft.id,
    payGroupId: draft.payGroupId,
    year: draft.year,
    month: draft.month,
    startDate: String(draft.startDate),
    endDate: String(draft.endDate),
    currency: draft.currency,
    status: 'draft',
  });
  return `${made} دورات مقفلة`;
};

/**
 * سياسة نقص الدوام مفعّلة (سماحية 30 دقيقة، الافتراضي الراتب، الإجازة السنوية للرصيد، اقتراح إجراء بعد 3 مرات)
 * وقرارات مدير على مسودة الشهر الحالي: موظف بالرصيد وآخر بالإعفاء، ثم تُعاد احتساب المسودة.
 * Shortfall policy enabled plus two manager decisions on the current draft, then the draft is recalculated.
 */
const seedHistoryShortfall = async (ctx: Ctx): Promise<string | undefined> => {
  const { trx, companyId } = ctx;
  const policy = await trx
    .selectFrom('shortfallPolicies')
    .select('companyId')
    .where('companyId', '=', companyId)
    .executeTakeFirst();
  if (policy) return 'skip';
  const draft = await trx
    .selectFrom('payrollPeriods')
    .selectAll()
    .where('companyId', '=', companyId)
    .where('status', '=', 'draft')
    .orderBy('year', 'desc')
    .orderBy('month', 'desc')
    .executeTakeFirst();
  const annual = await trx
    .selectFrom('leaveTypes')
    .select('id')
    .where('companyId', '=', companyId)
    .where('code', '=', 'DEMO-ANNUAL')
    .executeTakeFirst();
  if (!draft || !annual) return 'skip لا دورة مسودة أو إجازة سنوية تجريبية';
  await trx
    .insertInto('shortfallPolicies')
    .values({
      companyId,
      isEnabled: true,
      method: 'minutes',
      countLate: true,
      countEarly: true,
      monthlyFreeMinutes: 30,
      minutesPerDay: 480,
      tiers: JSON.stringify([]),
      defaultTarget: 'salary',
      leaveTypeId: annual.id,
      suggestActionAfter: 3,
    })
    .execute();
  // أكثر موظفَين نقصاً في شهر المسودة
  const { rows } = await sql<{ employeeId: string }>`
    select employee_id from attendance_days
     where company_id = ${companyId} and day_date between ${String(draft.startDate)}::date and ${String(draft.endDate)}::date
       and (late_minutes > 0 or early_leave_minutes > 0)
     group by employee_id order by sum(late_minutes + early_leave_minutes) desc, employee_id limit 2`.execute(
    trx,
  );
  const targets = ['leave', 'waive'] as const;
  for (const [i, r] of rows.entries())
    await trx
      .insertInto('shortfallDecisions')
      .values({
        companyId,
        employeeId: r.employeeId,
        year: draft.year,
        month: draft.month,
        target: targets[i] as 'leave' | 'waive',
        reason: i === 0 ? 'اتفاق مع المدير: يُخصم من رصيد الإجازات' : 'إعفاء: ظرف قاهر',
      })
      .execute();
  await calculatePeriod(ctx, {
    id: draft.id,
    payGroupId: draft.payGroupId,
    year: draft.year,
    month: draft.month,
    startDate: String(draft.startDate),
    endDate: String(draft.endDate),
    currency: draft.currency,
    status: 'draft',
  });
  return `${rows.length} قرارات`;
};

export const seedDemoHistory = async (
  db: Db,
  companyId: string,
): Promise<{ part: HistoryPart; status: 'done' | 'skipped'; note?: string }[]> => {
  const parts: [HistoryPart, (ctx: Ctx) => Promise<string | undefined>][] = [
    ['historyLeave', seedHistoryLeave],
    ['historyAttendance', seedHistoryAttendance],
    ['historyPayroll', seedHistoryPayroll],
    ['historyShortfall', seedHistoryShortfall],
  ];
  const out: { part: HistoryPart; status: 'done' | 'skipped'; note?: string }[] = [];
  for (const [part, fn] of parts) {
    const note = await withTenant(db, { companyId, requestId: 'cli' }, fn);
    if (note?.startsWith('skip'))
      out.push({ part, status: 'skipped', note: note.slice(5) || undefined });
    else out.push({ part, status: 'done', note });
  }
  return out;
};
