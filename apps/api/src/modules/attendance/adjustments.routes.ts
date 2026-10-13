import { Router, type Request, type RequestHandler, type Response } from 'express';
import { z } from 'zod';
import {
  adjustmentListQuery,
  correctionDirectInput,
  correctionInput,
  overtimeInput,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { ApprovalEngine } from '../../approvals/index.js';
import { hasPermission, requirePermission } from '../identity/index.js';
import {
  directCorrection,
  loadPolicy,
  submitCorrection,
  submitOvertime,
  withdrawAdjustment,
} from './adjustments.js';

const idParam = z.object({ id: z.string().uuid() });
const noteBody = z.object({ note: z.string().trim().max(300).nullish() });

const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };

const employeeOfUser = async (ctx: Ctx, userId: string): Promise<string | null> =>
  (
    await ctx.trx
      .selectFrom('employees')
      .select('id')
      .where('companyId', '=', ctx.companyId)
      .where('userId', '=', userId)
      .executeTakeFirst()
  )?.id ?? null;

type ListQuery = z.infer<typeof adjustmentListQuery>;

const makeRouter = (db: Db, authenticate: RequestHandler) => {
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
  /** الموظف المقصود: نفسه، أو غيره بصلاحية الإدارة */
  const target = async (req: Request, ctx: Ctx, wanted: string | undefined, managePerm: string) => {
    const auth = req.auth as NonNullable<Request['auth']>;
    const canManage = hasPermission(auth, managePerm);
    const mine = await employeeOfUser(ctx, auth.userId);
    if (wanted && wanted !== mine) {
      if (!canManage)
        throw new AppError('FORBIDDEN', 403, 'التقديم نيابةً عن موظف آخر يتطلب صلاحية الإدارة');
      return wanted;
    }
    if (!mine) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
    return mine;
  };
  return { router, run, target };
};

/** تعديلات الحضور: طلب موظف بموافقة، أو تعديل مباشر من الإدارة. */
export const createCorrectionsRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
): Router => {
  const { router, run, target } = makeRouter(db, authenticate);
  const select = (ctx: Ctx) =>
    ctx.trx
      .selectFrom('attendanceCorrections as r')
      .innerJoin('employees as e', 'e.id', 'r.employeeId')
      .select([
        'r.id',
        'r.employeeId',
        'e.fullNameAr as employeeName',
        'r.dayDate',
        'r.inAt',
        'r.outAt',
        'r.reason',
        'r.method',
        'r.status',
        'r.approvalRequestId',
        'r.createdAt',
        'r.version',
      ])
      .where('r.companyId', '=', ctx.companyId);
  const list = async (ctx: Ctx, q: ListQuery, employeeId?: string) => {
    const apply = <T extends ReturnType<typeof select>>(b: T): T => {
      let x = b as ReturnType<typeof select>;
      if (employeeId) x = x.where('r.employeeId', '=', employeeId);
      if (q.employeeId) x = x.where('r.employeeId', '=', q.employeeId);
      if (q.status) x = x.where('r.status', '=', q.status);
      if (q.from) x = x.where('r.dayDate', '>=', q.from);
      if (q.to) x = x.where('r.dayDate', '<=', q.to);
      return x as T;
    };
    const rows = await apply(select(ctx))
      .orderBy('r.dayDate', 'desc')
      .orderBy('r.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    const total = Number(
      (
        await apply(select(ctx))
          .clearSelect()
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
    return { rows, total };
  };

  router.get(
    '/policy',
    wrap(async (req, res) => {
      res.json({ data: await run(req, (ctx) => loadPolicy(ctx)) });
    }),
  );

  router.post(
    '/',
    requirePermission('attendance.correction.submit'),
    wrap(async (req, res) => {
      const body = correctionInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const employeeId = await target(req, ctx, body.employeeId, 'attendance.correction.manage');
        const id = await submitCorrection(
          ctx,
          engine,
          { userId: auth.userId, canManage: hasPermission(auth, 'attendance.correction.manage') },
          employeeId,
          body,
        );
        return select(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.post(
    '/direct',
    requirePermission('attendance.correction.manage'),
    wrap(async (req, res) => {
      const body = correctionDirectInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const id = await directCorrection(ctx, auth.userId, body);
        return select(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/me',
    wrap(async (req, res) => {
      const q = adjustmentListQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx) => {
        const me = await employeeOfUser(ctx, (req.auth as { userId: string }).userId);
        if (!me) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
        return list(ctx, q, me);
      });
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    }),
  );

  router.get(
    '/',
    requirePermission('attendance.correction.read_all'),
    wrap(async (req, res) => {
      const q = adjustmentListQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx) => list(ctx, q));
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    }),
  );

  router.post(
    '/:id/withdraw',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { note } = noteBody.parse(req.body ?? {});
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await withdrawAdjustment(
          ctx,
          engine,
          'attendanceCorrections',
          id,
          { userId: auth.userId, canManage: hasPermission(auth, 'attendance.correction.manage') },
          note,
        );
        return select(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.json({ data });
    }),
  );
  return router;
};

/** طلبات العمل الإضافي (مسبقة أو لاحقة) بموافقة الإدارة. */
export const createOvertimeRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
): Router => {
  const { router, run, target } = makeRouter(db, authenticate);
  const select = (ctx: Ctx) =>
    ctx.trx
      .selectFrom('overtimeRequests as r')
      .innerJoin('employees as e', 'e.id', 'r.employeeId')
      .leftJoin('attendanceDays as d', (j) =>
        j.onRef('d.employeeId', '=', 'r.employeeId').onRef('d.dayDate', '=', 'r.dayDate'),
      )
      .select([
        'r.id',
        'r.employeeId',
        'e.fullNameAr as employeeName',
        'r.dayDate',
        'r.minutes',
        'r.reason',
        'r.kind',
        'r.status',
        'r.approvalRequestId',
        'r.createdAt',
        'r.version',
        'd.surplusMinutes',
        'd.overtimeMinutes',
      ])
      .where('r.companyId', '=', ctx.companyId);
  const list = async (ctx: Ctx, q: ListQuery, employeeId?: string) => {
    const apply = <T extends ReturnType<typeof select>>(b: T): T => {
      let x = b as ReturnType<typeof select>;
      if (employeeId) x = x.where('r.employeeId', '=', employeeId);
      if (q.employeeId) x = x.where('r.employeeId', '=', q.employeeId);
      if (q.status) x = x.where('r.status', '=', q.status);
      if (q.from) x = x.where('r.dayDate', '>=', q.from);
      if (q.to) x = x.where('r.dayDate', '<=', q.to);
      return x as T;
    };
    const rows = await apply(select(ctx))
      .orderBy('r.dayDate', 'desc')
      .orderBy('r.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    const total = Number(
      (
        await apply(select(ctx))
          .clearSelect()
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
    return { rows, total };
  };

  router.post(
    '/',
    requirePermission('attendance.overtime.submit'),
    wrap(async (req, res) => {
      const body = overtimeInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const employeeId = await target(req, ctx, body.employeeId, 'attendance.overtime.manage');
        const id = await submitOvertime(
          ctx,
          engine,
          { userId: auth.userId, canManage: hasPermission(auth, 'attendance.overtime.manage') },
          employeeId,
          body,
        );
        return select(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    }),
  );

  router.get(
    '/me',
    wrap(async (req, res) => {
      const q = adjustmentListQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx) => {
        const me = await employeeOfUser(ctx, (req.auth as { userId: string }).userId);
        if (!me) throw new AppError('NO_EMPLOYEE', 409, 'حسابك غير مرتبط بملف موظف');
        return list(ctx, q, me);
      });
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    }),
  );

  router.get(
    '/',
    requirePermission('attendance.overtime.read_all'),
    wrap(async (req, res) => {
      const q = adjustmentListQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx) => list(ctx, q));
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    }),
  );

  router.post(
    '/:id/withdraw',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const { note } = noteBody.parse(req.body ?? {});
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await withdrawAdjustment(
          ctx,
          engine,
          'overtimeRequests',
          id,
          { userId: auth.userId, canManage: hasPermission(auth, 'attendance.overtime.manage') },
          note,
        );
        return select(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.json({ data });
    }),
  );
  return router;
};
