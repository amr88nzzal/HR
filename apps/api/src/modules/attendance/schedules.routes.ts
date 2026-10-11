import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  scheduleAssignmentInput,
  shiftInput,
  workScheduleInput,
  type ShiftInput,
  type WorkScheduleInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { ensureRefsExist } from '../org/index.js';
import { loadShifts, resolveSchedule } from './schedule.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const SCOPE_TABLE = {
  branch: 'branches',
  department: 'departments',
  employee: 'employees',
} as const;

const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      fn,
    );
  };

const dupOrThrow = (err: unknown, message: string): never => {
  const code = (err as { code?: string }).code;
  if (code === '23505') throw new AppError('DUPLICATE', 409, message);
  throw err;
};

const wrap =
  (fn: (req: Request, res: import('express').Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

/** الورديات وفتراتها. */
export const createShiftsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  const updateSchema = shiftInput.extend({ version: z.number().int().min(1) });

  const writeSegments = async (ctx: Ctx, shiftId: string, segments: ShiftInput['segments']) => {
    await ctx.trx.deleteFrom('shiftSegments').where('shiftId', '=', shiftId).execute();
    await ctx.trx
      .insertInto('shiftSegments')
      .values(
        segments.map((s, i) => ({
          companyId: ctx.companyId,
          shiftId,
          position: i + 1,
          startTime: s.startTime,
          endTime: s.endTime,
          endsNextDay: s.endsNextDay,
        })),
      )
      .execute();
  };

  router.get(
    '/',
    requirePermission('attendance.shift.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) => loadShifts(ctx));
      res.json({ data, meta: { page: 1, pageSize: data.length, total: data.length } });
    }),
  );

  router.get(
    '/:id',
    requirePermission('attendance.shift.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = await run(req, async (ctx) => {
        const s = (await loadShifts(ctx, [id]))[0];
        if (!s) throw new AppError('NOT_FOUND', 404, 'الوردية غير موجودة');
        return s;
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission('attendance.shift.create'),
    wrap(async (req, res) => {
      const { segments, ...body } = shiftInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        try {
          const row = await ctx.trx
            .insertInto('shifts')
            .values({ companyId: ctx.companyId, ...body })
            .returning('id')
            .executeTakeFirstOrThrow();
          await writeSegments(ctx, row.id, segments);
          return (await loadShifts(ctx, [row.id]))[0];
        } catch (err) {
          return dupOrThrow(err, 'رمز الوردية مستخدم');
        }
      });
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/:id',
    requirePermission('attendance.shift.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { segments, version, ...changes } = updateSchema.parse(req.body);
      const data = await run(req, async (ctx) => {
        try {
          const r = await ctx.trx
            .updateTable('shifts')
            .set({ ...changes, version: sql`version + 1` })
            .where('id', '=', id)
            .where('version', '=', version)
            .executeTakeFirst();
          if (r.numUpdatedRows === 0n) {
            const exists = await ctx.trx
              .selectFrom('shifts')
              .select('id')
              .where('id', '=', id)
              .executeTakeFirst();
            if (!exists) throw new AppError('NOT_FOUND', 404, 'الوردية غير موجودة');
            throw new AppError(
              'VERSION_CONFLICT',
              409,
              'تم تعديل السجل من مستخدم آخر، أعد التحميل',
            );
          }
          await writeSegments(ctx, id, segments);
        } catch (err) {
          return dupOrThrow(err, 'رمز الوردية مستخدم');
        }
        return (await loadShifts(ctx, [id]))[0];
      });
      res.json({ data });
    }),
  );

  router.delete(
    '/:id',
    requirePermission('attendance.shift.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const used = await ctx.trx
          .selectFrom('workScheduleDays')
          .select('id')
          .where('shiftId', '=', id)
          .executeTakeFirst();
        if (used)
          throw new AppError('IN_USE', 409, 'الوردية مستخدمة في جدول دوام؛ عطّلها بدل الحذف');
        const r = await ctx.trx.deleteFrom('shifts').where('id', '=', id).executeTakeFirst();
        if (r.numDeletedRows === 0n) throw new AppError('NOT_FOUND', 404, 'الوردية غير موجودة');
      });
      res.status(204).end();
    }),
  );
  return router;
};

type ScheduleDto = {
  id: string;
  code: string;
  nameAr: string;
  nameEn: string | null;
  isActive: boolean;
  version: number;
  days: { weekday: number; shiftId: string | null }[];
};

const loadSchedules = async (ctx: Ctx, id?: string): Promise<ScheduleDto[]> => {
  let q = ctx.trx
    .selectFrom('workSchedules')
    .select(['id', 'code', 'nameAr', 'nameEn', 'isActive', 'version'])
    .where('companyId', '=', ctx.companyId);
  if (id) q = q.where('id', '=', id);
  const rows = await q.orderBy('code').execute();
  if (rows.length === 0) return [];
  const days = await ctx.trx
    .selectFrom('workScheduleDays')
    .select(['scheduleId', 'weekday', 'shiftId'])
    .where(
      'scheduleId',
      'in',
      rows.map((r) => r.id),
    )
    .orderBy('weekday')
    .execute();
  return rows.map((r) => ({
    ...r,
    days: days
      .filter((d) => d.scheduleId === r.id)
      .map((d) => ({ weekday: d.weekday, shiftId: d.shiftId })),
  }));
};

/** الجداول الأسبوعية (وردية لكل يوم). */
export const createSchedulesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  const updateSchema = workScheduleInput.extend({ version: z.number().int().min(1) });

  const writeDays = async (ctx: Ctx, scheduleId: string, days: WorkScheduleInput['days']) => {
    const shiftIds = [...new Set(days.map((d) => d.shiftId).filter((x): x is string => !!x))];
    await ensureRefsExist(ctx, 'shifts', shiftIds);
    await ctx.trx.deleteFrom('workScheduleDays').where('scheduleId', '=', scheduleId).execute();
    await ctx.trx
      .insertInto('workScheduleDays')
      .values(days.map((d) => ({ companyId: ctx.companyId, scheduleId, ...d })))
      .execute();
  };

  router.get(
    '/',
    requirePermission('attendance.schedule.read'),
    wrap(async (req, res) => {
      const data = await run(req, (ctx) => loadSchedules(ctx));
      res.json({ data, meta: { page: 1, pageSize: data.length, total: data.length } });
    }),
  );

  router.get(
    '/:id',
    requirePermission('attendance.schedule.read'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const data = await run(req, async (ctx) => {
        const s = (await loadSchedules(ctx, id))[0];
        if (!s) throw new AppError('NOT_FOUND', 404, 'الجدول غير موجود');
        return s;
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission('attendance.schedule.create'),
    wrap(async (req, res) => {
      const { days, ...body } = workScheduleInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        try {
          const row = await ctx.trx
            .insertInto('workSchedules')
            .values({ companyId: ctx.companyId, ...body })
            .returning('id')
            .executeTakeFirstOrThrow();
          await writeDays(ctx, row.id, days);
          return (await loadSchedules(ctx, row.id))[0];
        } catch (err) {
          return dupOrThrow(err, 'رمز الجدول مستخدم');
        }
      });
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/:id',
    requirePermission('attendance.schedule.update'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { days, version, ...changes } = updateSchema.parse(req.body);
      const data = await run(req, async (ctx) => {
        try {
          const r = await ctx.trx
            .updateTable('workSchedules')
            .set({ ...changes, version: sql`version + 1` })
            .where('id', '=', id)
            .where('version', '=', version)
            .executeTakeFirst();
          if (r.numUpdatedRows === 0n) {
            const exists = await ctx.trx
              .selectFrom('workSchedules')
              .select('id')
              .where('id', '=', id)
              .executeTakeFirst();
            if (!exists) throw new AppError('NOT_FOUND', 404, 'الجدول غير موجود');
            throw new AppError(
              'VERSION_CONFLICT',
              409,
              'تم تعديل السجل من مستخدم آخر، أعد التحميل',
            );
          }
          await writeDays(ctx, id, days);
        } catch (err) {
          return dupOrThrow(err, 'رمز الجدول مستخدم');
        }
        return (await loadSchedules(ctx, id))[0];
      });
      res.json({ data });
    }),
  );

  router.delete(
    '/:id',
    requirePermission('attendance.schedule.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const used = await ctx.trx
          .selectFrom('scheduleAssignments')
          .select('id')
          .where('scheduleId', '=', id)
          .executeTakeFirst();
        if (used)
          throw new AppError('IN_USE', 409, 'الجدول معيَّن على نطاق؛ احذف التعيين أو عطّله');
        const r = await ctx.trx.deleteFrom('workSchedules').where('id', '=', id).executeTakeFirst();
        if (r.numDeletedRows === 0n) throw new AppError('NOT_FOUND', 404, 'الجدول غير موجود');
      });
      res.status(204).end();
    }),
  );
  return router;
};

const resolveQuery = z.object({
  employeeId: uuid,
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

/** تعيين الجداول على النطاقات + معاينة «ما جدول هذا الموظف في هذا اليوم». */
export const createScheduleAssignmentsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/',
    requirePermission('attendance.schedule.read'),
    wrap(async (req, res) => {
      const { scheduleId } = z.object({ scheduleId: uuid.optional() }).parse(req.query);
      const data = await run(req, async (ctx) => {
        let q = ctx.trx
          .selectFrom('scheduleAssignments')
          .select(['id', 'scheduleId', 'scope', 'scopeRef', 'validFrom', 'validTo'])
          .where('companyId', '=', ctx.companyId);
        if (scheduleId) q = q.where('scheduleId', '=', scheduleId);
        return q.orderBy('validFrom', 'desc').orderBy('id').execute();
      });
      res.json({ data });
    }),
  );

  router.get(
    '/resolve',
    requirePermission('attendance.schedule.read'),
    wrap(async (req, res) => {
      const q = resolveQuery.parse(req.query);
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [q.employeeId]);
        return resolveSchedule(ctx, q.employeeId, q.date);
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    requirePermission('attendance.schedule.create'),
    wrap(async (req, res) => {
      const body = scheduleAssignmentInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'workSchedules', [body.scheduleId]);
        if (body.scope !== 'company' && body.scopeRef)
          await ensureRefsExist(ctx, SCOPE_TABLE[body.scope], [body.scopeRef]);
        try {
          return await ctx.trx
            .insertInto('scheduleAssignments')
            .values({
              companyId: ctx.companyId,
              scheduleId: body.scheduleId,
              scope: body.scope,
              scopeRef: body.scopeRef ?? null,
              validFrom: body.validFrom,
              validTo: body.validTo ?? null,
            })
            .returning(['id', 'scheduleId', 'scope', 'scopeRef', 'validFrom', 'validTo'])
            .executeTakeFirstOrThrow();
        } catch (err) {
          return dupOrThrow(err, 'هذا التعيين موجود مسبقاً');
        }
      });
      res.status(201).json({ data });
    }),
  );

  router.delete(
    '/:id',
    requirePermission('attendance.schedule.delete'),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        const r = await ctx.trx
          .deleteFrom('scheduleAssignments')
          .where('id', '=', id)
          .executeTakeFirst();
        if (r.numDeletedRows === 0n) throw new AppError('NOT_FOUND', 404, 'التعيين غير موجود');
      });
      res.status(204).end();
    }),
  );
  return router;
};
