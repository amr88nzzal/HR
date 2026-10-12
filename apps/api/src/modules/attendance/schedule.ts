import { sql } from 'kysely';
import type { Ctx } from '../../db/tenant.js';

export type ShiftDto = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  color: string | null;
  lateGraceMinutes: number;
  earlyLeaveGraceMinutes: number;
  isActive: boolean;
  version: number;
  segments: { position: number; startTime: string; endTime: string; endsNextDay: boolean }[];
};

const hhmm = (t: string): string => t.slice(0, 5);

/** الورديات مع فتراتها (مرتبة)؛ ids اختياري للتصفية. */
export const loadShifts = async (ctx: Ctx, ids?: string[]): Promise<ShiftDto[]> => {
  if (ids && ids.length === 0) return [];
  let q = ctx.trx
    .selectFrom('shifts')
    .select([
      'id',
      'code',
      'nameAr',
      'nameEn',
      'color',
      'lateGraceMinutes',
      'earlyLeaveGraceMinutes',
      'isActive',
      'version',
    ])
    .where('companyId', '=', ctx.companyId);
  if (ids) q = q.where('id', 'in', ids);
  const shifts = await q.orderBy('code').execute();
  if (shifts.length === 0) return [];
  const segs = await ctx.trx
    .selectFrom('shiftSegments')
    .select(['shiftId', 'position', 'startTime', 'endTime', 'endsNextDay'])
    .where(
      'shiftId',
      'in',
      shifts.map((s) => s.id),
    )
    .orderBy('position')
    .execute();
  return shifts.map((s) => ({
    ...s,
    segments: segs
      .filter((x) => x.shiftId === s.id)
      .map((x) => ({
        position: x.position,
        startTime: hhmm(x.startTime),
        endTime: hhmm(x.endTime),
        endsNextDay: x.endsNextDay,
      })),
  }));
};

export type ResolvedSchedule = {
  scheduleId: string;
  scheduleCode: string;
  scope: string;
  /** وردية اليوم؛ null = يوم راحة في الجدول */
  shift: ShiftDto | null;
};

/**
 * الجدول الساري لموظف في تاريخ، ووردية ذلك اليوم.
 * الأخص يغلب (موظف ← قسم ← فرع ← شركة) ثم الأحدث بدءاً. لا جدول = null (الحضور غير مجدول).
 */
export const resolveSchedule = async (
  ctx: Ctx,
  employeeId: string,
  onDate: string,
  shiftCache?: Map<string, ShiftDto | null>,
): Promise<ResolvedSchedule | null> => {
  const { rows } = await sql<{ scheduleId: string; scheduleCode: string; scope: string }>`
    select a.schedule_id as schedule_id, s.code as schedule_code, a.scope
    from schedule_assignments a
    join work_schedules s on s.id = a.schedule_id and s.is_active
    left join employments e on e.employee_id = ${employeeId}
      and e.valid_from <= ${onDate}::date and (e.valid_to is null or e.valid_to >= ${onDate}::date)
    where a.company_id = ${ctx.companyId}
      and a.valid_from <= ${onDate}::date
      and (a.valid_to is null or a.valid_to >= ${onDate}::date)
      and (
        a.scope = 'company'
        or (a.scope = 'employee' and a.scope_ref = ${employeeId})
        or (a.scope = 'department' and a.scope_ref = e.department_id)
        or (a.scope = 'branch' and a.scope_ref = e.branch_id)
      )
    order by case a.scope when 'employee' then 1 when 'department' then 2 when 'branch' then 3 else 4 end,
             a.valid_from desc
    limit 1`.execute(ctx.trx);
  const hit = rows[0];
  if (!hit) return null;
  const weekday = new Date(`${onDate}T00:00:00Z`).getUTCDay();
  const day = await ctx.trx
    .selectFrom('workScheduleDays')
    .select('shiftId')
    .where('scheduleId', '=', hit.scheduleId)
    .where('weekday', '=', weekday)
    .executeTakeFirst();
  let shift: ShiftDto | null = null;
  if (day?.shiftId) {
    const cached = shiftCache?.get(day.shiftId);
    if (cached !== undefined) shift = cached;
    else {
      shift = (await loadShifts(ctx, [day.shiftId]))[0] ?? null;
      shiftCache?.set(day.shiftId, shift);
    }
  }
  return { ...hit, shift };
};

export type ScheduleBook = {
  resolve: (employeeId: string, onDate: string) => ResolvedSchedule | null;
};

const SCOPE_RANK: Record<string, number> = { employee: 1, department: 2, branch: 3, company: 4 };

/**
 * يحمّل التعيينات والجداول والورديات والتعيينات الوظيفية مرة واحدة لفترة، ثم يحلّ كل (موظف، يوم) في الذاكرة
 * بالقاعدة نفسها لـ resolveSchedule (الأخص ثم الأحدث بدءاً). للاحتساب الجماعي.
 */
export const loadScheduleBook = async (
  ctx: Ctx,
  employeeIds: string[],
  from: string,
  to: string,
): Promise<ScheduleBook> => {
  const assignments = await ctx.trx
    .selectFrom('scheduleAssignments as a')
    .innerJoin('workSchedules as s', 's.id', 'a.scheduleId')
    .select([
      'a.scheduleId',
      's.code as scheduleCode',
      'a.scope',
      'a.scopeRef',
      'a.validFrom',
      'a.validTo',
    ])
    .where('a.companyId', '=', ctx.companyId)
    .where('s.isActive', '=', true)
    .where('a.validFrom', '<=', to)
    .where(sql<boolean>`(a.valid_to is null or a.valid_to >= ${from}::date)`)
    .execute();
  const scheduleIds = [...new Set(assignments.map((a) => a.scheduleId))];
  const dayRows =
    scheduleIds.length === 0
      ? []
      : await ctx.trx
          .selectFrom('workScheduleDays')
          .select(['scheduleId', 'weekday', 'shiftId'])
          .where('scheduleId', 'in', scheduleIds)
          .execute();
  const shiftOfDay = new Map<string, string | null>(
    dayRows.map((d) => [`${d.scheduleId}:${d.weekday}`, d.shiftId]),
  );
  const shiftIds = [...new Set(dayRows.map((d) => d.shiftId).filter((x): x is string => !!x))];
  const shifts = new Map((await loadShifts(ctx, shiftIds)).map((s) => [s.id, s]));
  const emps =
    employeeIds.length === 0
      ? []
      : await ctx.trx
          .selectFrom('employments')
          .select(['employeeId', 'branchId', 'departmentId', 'validFrom', 'validTo'])
          .where('companyId', '=', ctx.companyId)
          .where('employeeId', 'in', employeeIds)
          .where('validFrom', '<=', to)
          .where(sql<boolean>`(valid_to is null or valid_to >= ${from}::date)`)
          .execute();
  const empByEmployee = new Map<string, typeof emps>();
  for (const e of emps)
    empByEmployee.set(e.employeeId, [...(empByEmployee.get(e.employeeId) ?? []), e]);
  const sorted = [...assignments].sort(
    (x, y) =>
      (SCOPE_RANK[x.scope] ?? 9) - (SCOPE_RANK[y.scope] ?? 9) ||
      (x.validFrom < y.validFrom ? 1 : x.validFrom > y.validFrom ? -1 : 0),
  );
  return {
    resolve: (employeeId, onDate) => {
      const emp = (empByEmployee.get(employeeId) ?? []).find(
        (e) => e.validFrom <= onDate && (!e.validTo || e.validTo >= onDate),
      );
      const hit = sorted.find(
        (a) =>
          a.validFrom <= onDate &&
          (!a.validTo || a.validTo >= onDate) &&
          (a.scope === 'company' ||
            (a.scope === 'employee' && a.scopeRef === employeeId) ||
            (a.scope === 'department' && !!emp && a.scopeRef === emp.departmentId) ||
            (a.scope === 'branch' && !!emp && a.scopeRef === emp.branchId)),
      );
      if (!hit) return null;
      const weekday = new Date(`${onDate}T00:00:00Z`).getUTCDay();
      const shiftId = shiftOfDay.get(`${hit.scheduleId}:${weekday}`) ?? null;
      return {
        scheduleId: hit.scheduleId,
        scheduleCode: hit.scheduleCode,
        scope: hit.scope,
        shift: shiftId ? (shifts.get(shiftId) ?? null) : null,
      };
    },
  };
};
