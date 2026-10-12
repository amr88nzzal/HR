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
