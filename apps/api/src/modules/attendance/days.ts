import { sql, type Insertable } from 'kysely';
import type { AttendanceDaysTable } from '../../db/types.js';
import type { Ctx } from '../../db/tenant.js';
import { computeDay, type DayInput, type Punch, type Segment } from './engine.js';
import { loadShifts, resolveSchedule, type ShiftDto } from './schedule.js';
import { addDays, diffDays, localParts, minutesOf } from './time.js';

/** تقبل بصمات من 3 ساعات قبل بدء الوردية حتى 4 ساعات بعد نهايتها */
const EARLY_WINDOW = 180;
const LATE_WINDOW = 240;
export const MAX_RECOMPUTE_DAYS = 62;

const toSegments = (s: ShiftDto): Segment[] =>
  s.segments.map((x) => ({
    start: minutesOf(x.startTime),
    end: minutesOf(x.endTime) + (x.endsNextDay ? 1440 : 0),
  }));

type PunchRow = { id: string; punchedAt: Date; direction: 'in' | 'out' | null };

export const companyTimezone = async (ctx: Ctx): Promise<string> =>
  (
    await ctx.trx
      .selectFrom('companies')
      .select('timezone')
      .where('id', '=', ctx.companyId)
      .executeTakeFirstOrThrow()
  ).timezone;

export const companyToday = async (ctx: Ctx): Promise<string> =>
  (await sql<{ d: string }>`select company_today(${ctx.companyId})::text as d`.execute(ctx.trx))
    .rows[0]?.d as string;

type Env = { tz: string; today: string; holidays: Set<string> };

/** يحتسب أيام موظف واحد في [from, to] ويكتبها (يحفظ التجاوز اليدوي ويضع تحذير الفرق). */
const recomputeEmployee = async (
  ctx: Ctx,
  employeeId: string,
  hireDate: string | null,
  from: string,
  to: string,
  env: Env,
): Promise<number> => {
  // جدول كل يوم من اليوم السابق للّاحق (الدوام الليلي يمتد بين يومين)
  const shiftOf = new Map<string, { kind: 'none' | 'off' | 'work'; shift: ShiftDto | null }>();
  const shiftCache = new Map<string, ShiftDto | null>();
  for (let d = addDays(from, -1); d <= addDays(to, 1); d = addDays(d, 1)) {
    const r = await resolveSchedule(ctx, employeeId, d, shiftCache);
    shiftOf.set(d, { kind: !r ? 'none' : r.shift ? 'work' : 'off', shift: r?.shift ?? null });
  }

  const startUtc = new Date(Date.parse(`${addDays(from, -2)}T00:00:00Z`));
  const endUtc = new Date(Date.parse(`${addDays(to, 3)}T00:00:00Z`));
  const punches = (await ctx.trx
    .selectFrom('attendanceRecords')
    .select(['id', 'punchedAt', 'direction'])
    .where('companyId', '=', ctx.companyId)
    .where('employeeId', '=', employeeId)
    .where('punchedAt', '>=', startUtc)
    .where('punchedAt', '<', endUtc)
    .orderBy('punchedAt')
    .execute()) as PunchRow[];

  // نسب كل بصمة ليوم الحضور الأنسب (نافذة الوردية، وإلا اليوم المحلي)
  const byDay = new Map<string, Punch<PunchRow>[]>();
  for (const p of punches) {
    const lp = localParts(p.punchedAt, env.tz);
    let best: { date: string; dist: number } | null = null;
    for (const cand of [addDays(lp.date, -1), lp.date, addDays(lp.date, 1)]) {
      const segs = shiftOf.get(cand)?.shift;
      if (!segs) continue;
      const sg = toSegments(segs);
      const rel = lp.minute + diffDays(lp.date, cand) * 1440;
      const first = sg[0]?.start ?? 0;
      const last = sg[sg.length - 1]?.end ?? 0;
      if (rel >= first - EARLY_WINDOW && rel <= last + LATE_WINDOW) {
        const dist = Math.abs(rel - first);
        if (!best || dist < best.dist) best = { date: cand, dist };
      }
    }
    const day = best?.date ?? lp.date;
    const minute = lp.minute + diffDays(lp.date, day) * 1440;
    const arr = byDay.get(day) ?? [];
    arr.push({ minute, direction: p.direction, ref: p });
    byDay.set(day, arr);
  }

  const leave = new Map(
    (
      await sql<{ d: string; units: string }>`
        select d.day_date::text as d, sum(d.units)::text as units
          from leave_request_days d join leave_requests r on r.id = d.request_id
         where r.company_id = ${ctx.companyId} and r.employee_id = ${employeeId}
           and r.status = 'approved' and d.day_date between ${from}::date and ${to}::date
         group by d.day_date`.execute(ctx.trx)
    ).rows.map((r) => [r.d, Number(r.units)]),
  );

  const rows: Insertable<AttendanceDaysTable>[] = [];
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (d > env.today) break; // لا نحتسب المستقبل
    if (hireDate && d < hireDate) continue;
    const sc = shiftOf.get(d) ?? { kind: 'none' as const, shift: null };
    const input: DayInput<PunchRow> = {
      kind: sc.kind,
      segments: sc.shift ? toSegments(sc.shift) : [],
      lateGrace: sc.shift?.lateGraceMinutes ?? 0,
      earlyLeaveGrace: sc.shift?.earlyLeaveGraceMinutes ?? 0,
      holiday: env.holidays.has(d),
      leaveUnits: leave.get(d) ?? 0,
      isPast: d < env.today,
      punches: byDay.get(d) ?? [],
    };
    const r = computeDay(input);
    rows.push({
      companyId: ctx.companyId,
      employeeId,
      dayDate: d,
      status: r.status,
      shiftId: sc.shift?.id ?? null,
      scheduledMinutes: r.scheduledMinutes,
      firstIn: r.firstIn?.ref.punchedAt ?? null,
      lastOut: r.lastOut?.ref.punchedAt ?? null,
      workedMinutes: r.workedMinutes,
      lateMinutes: r.lateMinutes,
      earlyLeaveMinutes: r.earlyLeaveMinutes,
      surplusMinutes: r.surplusMinutes,
      leaveUnits: String(leave.get(d) ?? 0),
    });
  }
  if (rows.length === 0) return 0;
  await ctx.trx
    .insertInto('attendanceDays')
    .values(rows)
    .onConflict((oc) =>
      oc.columns(['companyId', 'employeeId', 'dayDate']).doUpdateSet({
        status: sql`excluded.status`,
        shiftId: sql`excluded.shift_id`,
        scheduledMinutes: sql`excluded.scheduled_minutes`,
        firstIn: sql`excluded.first_in`,
        lastOut: sql`excluded.last_out`,
        workedMinutes: sql`excluded.worked_minutes`,
        lateMinutes: sql`excluded.late_minutes`,
        earlyLeaveMinutes: sql`excluded.early_leave_minutes`,
        surplusMinutes: sql`excluded.surplus_minutes`,
        leaveUnits: sql`excluded.leave_units`,
        computedAt: sql`now()`,
        // التجاوز اليدوي يبقى؛ ونحذّر إن تغيّر الاحتساب عمّا كان وقت التجاوز
        diffWarning: sql`attendance_days.override_status is not null and (
          attendance_days.baseline_status is distinct from excluded.status
          or attendance_days.baseline_worked is distinct from excluded.worked_minutes)`,
      }),
    )
    .execute();
  return rows.length;
};

export type RecomputeResult = { employees: number; days: number };

/**
 * يعيد احتساب أيام الحضور لموظفين (أو كل غير المنتهية خدمتهم) في فترة.
 * آمن للتكرار: يحدّث القيم المحتسبة ويحفظ التجاوزات اليدوية.
 */
export const recomputeDays = async (
  ctx: Ctx,
  employeeIds: string[] | 'all',
  from: string,
  to: string,
): Promise<RecomputeResult> => {
  const tz = await companyTimezone(ctx);
  const today = await companyToday(ctx);
  const holidays = new Set(
    (
      await ctx.trx
        .selectFrom('holidays')
        .select('holidayDate')
        .where('companyId', '=', ctx.companyId)
        .where('holidayDate', '>=', from)
        .where('holidayDate', '<=', to)
        .execute()
    ).map((h) => h.holidayDate),
  );
  let q = ctx.trx
    .selectFrom('employees')
    .select(['id', 'firstHireDate'])
    .where('companyId', '=', ctx.companyId);
  q =
    employeeIds === 'all'
      ? q.where('status', '<>', 'terminated')
      : q.where('id', 'in', employeeIds);
  const emps = employeeIds !== 'all' && employeeIds.length === 0 ? [] : await q.execute();
  let days = 0;
  for (const e of emps)
    days += await recomputeEmployee(ctx, e.id, e.firstHireDate ?? null, from, to, {
      tz,
      today,
      holidays,
    });
  return { employees: emps.length, days };
};

export { loadShifts };
