import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  attendanceClearOverrideInput,
  attendanceOverrideInput,
  attendanceRangeQuery,
  csvList,
  attendanceRecomputeInput,
  punchBulkInput,
  punchInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { hasPermission, requirePermission } from '../identity/index.js';
import { ensureRefsExist } from '../org/index.js';
import { companyTimezone, recomputeDays } from './days.js';
import { addDays, localToUtc } from './time.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const dayColumns = [
  'd.id',
  'd.employee_id',
  'd.day_date::text as day_date',
  'd.status as computed_status',
  'coalesce(d.override_status, d.status) as status',
  'd.shift_id',
  'd.scheduled_minutes',
  'd.first_in',
  'd.last_out',
  'd.worked_minutes',
  'd.late_minutes',
  'd.early_leave_minutes',
  'd.surplus_minutes',
  'd.overtime_minutes',
  'd.leave_units::text as leave_units',
  '(d.override_status is not null) as is_overridden',
  'd.override_note',
  'd.diff_warning',
];
const dayCols = sql.raw(dayColumns.join(', '));

type DayDto = {
  id: string;
  employeeId: string;
  dayDate: string;
  computedStatus: string;
  status: string;
  shiftId: string | null;
  scheduledMinutes: number;
  firstIn: string | null;
  lastOut: string | null;
  workedMinutes: number;
  lateMinutes: number;
  earlyLeaveMinutes: number;
  surplusMinutes: number;
  overtimeMinutes: number;
  leaveUnits: string;
  isOverridden: boolean;
  overrideNote: string | null;
  diffWarning: boolean;
};

const daysOf = async (ctx: Ctx, employeeId: string, from: string, to: string) =>
  (
    await sql<DayDto>`
      select ${dayCols} from attendance_days d
       where d.company_id = ${ctx.companyId} and d.employee_id = ${employeeId}
         and d.day_date between ${from}::date and ${to}::date
       order by d.day_date`.execute(ctx.trx)
  ).rows;

const employeeOfUser = async (ctx: Ctx, userId: string): Promise<string> => {
  const e = await ctx.trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('userId', '=', userId)
    .executeTakeFirst();
  if (!e) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
  return e.id;
};

/** إعادة احتساب الأيام المتأثرة ببصمة (اليوم السابق واللاحق للدوام الليلي). */
const refresh = (ctx: Ctx, employeeIds: string[], dates: string[]) => {
  const sorted = [...dates].sort();
  return recomputeDays(
    ctx,
    employeeIds,
    addDays(sorted[0] as string, -1),
    addDays(sorted[sorted.length - 1] as string, 1),
  );
};

const bulkQuery = z.object({
  employeeId: uuid.optional(),
  from: isoDate,
  to: isoDate,
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(100),
});

/** البصمات الخام وأيام الحضور المحتسبة: إدخال يدوي، عرض، إعادة احتساب، وتجاوز. */
export const createAttendanceRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };
  router.use(authenticate);

  // ───── البصمات ─────
  router.post(
    '/punches',
    requirePermission('attendance.punch.create'),
    wrap(async (req, res) => {
      const body = punchInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [body.employeeId]);
        const tz = await companyTimezone(ctx);
        const at = localToUtc(body.date, body.time, tz);
        try {
          const row = await ctx.trx
            .insertInto('attendanceRecords')
            .values({
              companyId: ctx.companyId,
              employeeId: body.employeeId,
              punchedAt: at,
              direction: body.direction ?? null,
              source: 'manual',
              note: body.note ?? null,
              createdBy: auth.userId,
            })
            .returning(['id', 'employeeId', 'punchedAt', 'direction', 'source', 'note'])
            .executeTakeFirstOrThrow();
          await refresh(ctx, [body.employeeId], [body.date]);
          return row;
        } catch (err) {
          if ((err as { code?: string }).code === '23505')
            throw new AppError('DUPLICATE', 409, 'توجد بصمة بنفس اللحظة لهذا الموظف');
          throw err;
        }
      });
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/punches/bulk',
    requirePermission('attendance.punch.create'),
    wrap(async (req, res) => {
      const { rows } = punchBulkInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const tz = await companyTimezone(ctx);
        const nos = [...new Set(rows.map((r) => r.employeeNo).filter((x): x is string => !!x))];
        const found = nos.length
          ? await ctx.trx
              .selectFrom('employees')
              .select(['id', 'employeeNo'])
              .where('companyId', '=', ctx.companyId)
              .where('employeeNo', 'in', nos)
              .execute()
          : [];
        const byNo = new Map(found.map((e) => [e.employeeNo, e.id]));
        const ids = [...new Set(rows.map((r) => r.employeeId).filter((x): x is string => !!x))];
        const okIds = new Set(
          ids.length
            ? (
                await ctx.trx
                  .selectFrom('employees')
                  .select('id')
                  .where('companyId', '=', ctx.companyId)
                  .where('id', 'in', ids)
                  .execute()
              ).map((e) => e.id)
            : [],
        );
        const errors: { row: number; error: string }[] = [];
        const toInsert: {
          employeeId: string;
          date: string;
          at: Date;
          direction: 'in' | 'out' | null;
        }[] = [];
        rows.forEach((r, i) => {
          const employeeId = r.employeeId ?? byNo.get(r.employeeNo as string);
          if (!employeeId || (r.employeeId && !okIds.has(r.employeeId)))
            return void errors.push({ row: i + 1, error: 'EMPLOYEE_NOT_FOUND' });
          toInsert.push({
            employeeId,
            date: r.date,
            at: localToUtc(r.date, r.time, tz),
            direction: r.direction ?? null,
          });
        });
        let inserted = 0;
        for (let i = 0; i < toInsert.length; i += 500) {
          const chunk = toInsert.slice(i, i + 500);
          const res2 = await ctx.trx
            .insertInto('attendanceRecords')
            .values(
              chunk.map((c) => ({
                companyId: ctx.companyId,
                employeeId: c.employeeId,
                punchedAt: c.at,
                direction: c.direction,
                source: 'manual' as const,
                createdBy: auth.userId,
              })),
            )
            .onConflict((oc) => oc.columns(['companyId', 'employeeId', 'punchedAt']).doNothing())
            .executeTakeFirst();
          inserted += Number(res2.numInsertedOrUpdatedRows ?? 0);
        }
        const duplicates = toInsert.length - inserted;
        // إعادة احتساب الموظفين المتأثرين على مدى تواريخهم
        const spans = new Map<string, string[]>();
        for (const t of toInsert)
          spans.set(t.employeeId, [...(spans.get(t.employeeId) ?? []), t.date]);
        for (const [employeeId, dates] of spans) await refresh(ctx, [employeeId], dates);
        return { inserted, duplicates, errors };
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/punches',
    requirePermission('attendance.punch.read'),
    wrap(async (req, res) => {
      const q = bulkQuery.parse(req.query);
      const data = await run(req, async (ctx) => {
        const tz = await companyTimezone(ctx);
        const lo = localToUtc(q.from, '00:00', tz);
        const hi = localToUtc(addDays(q.to, 1), '00:00', tz);
        let b = ctx.trx
          .selectFrom('attendanceRecords')
          .select(['id', 'employeeId', 'punchedAt', 'direction', 'source', 'note'])
          .where('companyId', '=', ctx.companyId)
          .where('punchedAt', '>=', lo)
          .where('punchedAt', '<', hi);
        if (q.employeeId) b = b.where('employeeId', '=', q.employeeId);
        return b
          .orderBy('punchedAt')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
      });
      res.json({ data });
    }),
  );

  router.delete(
    '/punches/:id',
    requirePermission('attendance.punch.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const tz = await companyTimezone(ctx);
        const row = await ctx.trx
          .selectFrom('attendanceRecords')
          .select(['employeeId', 'punchedAt', 'source'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!row) throw new AppError('NOT_FOUND', 404, 'البصمة غير موجودة');
        if (row.source !== 'manual')
          throw new AppError('NOT_MANUAL', 409, 'لا تُحذف إلا البصمات اليدوية');
        await ctx.trx.deleteFrom('attendanceRecords').where('id', '=', id).execute();
        const { localParts } = await import('./time.js');
        await refresh(ctx, [row.employeeId], [localParts(row.punchedAt, tz).date]);
      });
      res.status(204).end();
    }),
  );

  // ───── أيام الحضور ─────
  router.get(
    '/days/me',
    wrap(async (req, res) => {
      const q = attendanceRangeQuery.parse(req.query);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) =>
        daysOf(ctx, await employeeOfUser(ctx, auth.userId), q.from, q.to),
      );
      res.json({ data });
    }),
  );

  router.get(
    '/days',
    requirePermission('attendance.day.read_all'),
    wrap(async (req, res) => {
      const q = attendanceRangeQuery.parse(req.query);
      if (!q.employeeId) throw new AppError('VALIDATION_ERROR', 400, 'employeeId مطلوب');
      const employeeId = q.employeeId;
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [employeeId]);
        return daysOf(ctx, employeeId, q.from, q.to);
      });
      res.json({ data });
    }),
  );

  /** اللوحة اليومية: كل الموظفين ليوم واحد مع عدّاد الحالات. */
  router.get(
    '/daily',
    requirePermission('attendance.day.read_all'),
    wrap(async (req, res) => {
      const q = z
        .object({
          date: isoDate,
          departmentId: csvList(uuid),
          branchId: csvList(uuid),
          status: z.string().max(20).optional(),
        })
        .parse(req.query);
      const data = await run(req, async (ctx) => {
        const filters = [sql`e.company_id = ${ctx.companyId}`, sql`e.status <> 'terminated'`];
        if (q.departmentId?.length)
          filters.push(sql`cur.department_id = any(${q.departmentId}::uuid[])`);
        if (q.branchId?.length) filters.push(sql`cur.branch_id = any(${q.branchId}::uuid[])`);
        const where = sql.join(filters, sql` and `);
        const base = sql`from employees e
          left join employments cur on cur.employee_id = e.id
            and cur.valid_from <= ${q.date}::date and (cur.valid_to is null or cur.valid_to >= ${q.date}::date)
          left join attendance_days d on d.employee_id = e.id and d.day_date = ${q.date}::date
         where ${where}`;
        const rows = (
          await sql<DayDto & { employeeNo: string; employeeName: string }>`
            select e.employee_no, e.full_name_ar as employee_name, e.id as employee_id,
                   d.id, ${sql.raw(dayColumns.slice(2).join(', '))}
              ${base}
             order by e.employee_no`.execute(ctx.trx)
        ).rows;
        const filtered = q.status ? rows.filter((r) => (r.status ?? 'none') === q.status) : rows;
        const counts: Record<string, number> = {};
        for (const r of rows) counts[r.status ?? 'none'] = (counts[r.status ?? 'none'] ?? 0) + 1;
        return { rows: filtered, counts };
      });
      res.json({ data });
    }),
  );

  router.post(
    '/recompute',
    requirePermission('attendance.day.recompute'),
    wrap(async (req, res) => {
      const b = attendanceRecomputeInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        if (b.employeeId) await ensureRefsExist(ctx, 'employees', [b.employeeId]);
        return recomputeDays(ctx, b.employeeId ? [b.employeeId] : 'all', b.from, b.to);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/days/override',
    requirePermission('attendance.day.override'),
    wrap(async (req, res) => {
      const b = attendanceOverrideInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [b.employeeId]);
        await recomputeDays(ctx, [b.employeeId], b.date, b.date);
        const cur = await ctx.trx
          .selectFrom('attendanceDays')
          .select(['id', 'status', 'workedMinutes'])
          .where('companyId', '=', ctx.companyId)
          .where('employeeId', '=', b.employeeId)
          .where('dayDate', '=', b.date)
          .executeTakeFirst();
        if (!cur)
          throw new AppError('NOT_COMPUTABLE', 409, 'لا يمكن تجاوز يوم مستقبلي أو قبل التعيين');
        await ctx.trx
          .updateTable('attendanceDays')
          .set({
            overrideStatus: b.status,
            overrideNote: b.note,
            overrideBy: auth.userId,
            overrideAt: new Date(),
            baselineStatus: cur.status,
            baselineWorked: cur.workedMinutes,
            diffWarning: false,
          })
          .where('id', '=', cur.id)
          .execute();
        return (await daysOf(ctx, b.employeeId, b.date, b.date))[0];
      });
      res.json({ data });
    }),
  );

  /** إلغاء التجاوز (أو الإقرار بالفرق) فيعود اليوم للاحتساب. */
  router.post(
    '/days/clear-override',
    requirePermission('attendance.day.override'),
    wrap(async (req, res) => {
      const b = attendanceClearOverrideInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        await ctx.trx
          .updateTable('attendanceDays')
          .set({
            overrideStatus: null,
            overrideNote: null,
            overrideBy: null,
            overrideAt: null,
            baselineStatus: null,
            baselineWorked: null,
            diffWarning: false,
          })
          .where('companyId', '=', ctx.companyId)
          .where('employeeId', '=', b.employeeId)
          .where('dayDate', '=', b.date)
          .execute();
        return (await daysOf(ctx, b.employeeId, b.date, b.date))[0] ?? null;
      });
      res.json({ data });
    }),
  );

  void hasPermission;
  return router;
};
