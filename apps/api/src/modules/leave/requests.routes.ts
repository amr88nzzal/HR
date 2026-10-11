import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { leaveOverrideInput, leaveRequestInput, leaveRequestListQuery } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { ApprovalEngine } from '../../approvals/index.js';
import { hasPermission, requirePermission } from '../identity/index.js';
import { analyze, cancelRequest, overrideDays, previewDto, submitRequest } from './requests.js';

const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });

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

const baseSelect = (ctx: Ctx) =>
  ctx.trx
    .selectFrom('leaveRequests as r')
    .innerJoin('employees as e', 'e.id', 'r.employeeId')
    .innerJoin('leaveTypes as t', 't.id', 'r.leaveTypeId')
    .select((eb) => [
      'r.id',
      'r.employeeId',
      'e.fullNameAr as employeeName',
      'r.leaveTypeId',
      't.nameAr as leaveTypeNameAr',
      't.nameEn as leaveTypeNameEn',
      'r.startDate',
      'r.endDate',
      'r.firstDayHalf',
      'r.lastDayHalf',
      'r.reason',
      'r.days',
      'r.overrideDays',
      'r.overrideReason',
      eb.fn.coalesce('r.overrideDays', 'r.days').as('chargedDays'),
      'r.status',
      'r.approvalRequestId',
      'r.createdAt',
      'r.version',
    ])
    .where('r.companyId', '=', ctx.companyId);

type ListQuery = z.infer<typeof leaveRequestListQuery>;

const listRequests = async (ctx: Ctx, q: ListQuery, employeeId?: string) => {
  const apply = <T extends ReturnType<typeof baseSelect>>(b: T): T => {
    let x = b as ReturnType<typeof baseSelect>;
    if (employeeId) x = x.where('r.employeeId', '=', employeeId);
    if (q.employeeId) x = x.where('r.employeeId', '=', q.employeeId);
    if (q.status) x = x.where('r.status', '=', q.status);
    if (q.from) x = x.where('r.endDate', '>=', q.from);
    if (q.to) x = x.where('r.startDate', '<=', q.to);
    return x as T;
  };
  const rows = await apply(baseSelect(ctx))
    .orderBy('r.startDate', 'desc')
    .orderBy('r.id', 'desc')
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .execute();
  const total = Number(
    (
      await apply(baseSelect(ctx))
        .clearSelect()
        .select((eb) => eb.fn.countAll<string>().as('n'))
        .executeTakeFirstOrThrow()
    ).n,
  );
  return { rows, total };
};

/** طلبات الإجازة: المعاينة والتقديم والإلغاء والتجاوز. */
export const createLeaveRequestsRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
): Router => {
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
  const targetEmployee = async (req: Request, ctx: Ctx, wanted?: string): Promise<string> => {
    const auth = req.auth as NonNullable<Request['auth']>;
    const mine = await employeeOfUser(ctx, auth.userId).catch((e: unknown) => {
      if (wanted && hasPermission(auth, 'leave.request.manage')) return null;
      throw e;
    });
    if (!wanted || wanted === mine) return mine as string;
    if (!hasPermission(auth, 'leave.request.manage'))
      throw new AppError('FORBIDDEN', 403, 'التقديم نيابةً عن موظف آخر يتطلب صلاحية الإدارة');
    return wanted;
  };

  router.post('/preview', requirePermission('leave.request.submit'), async (req, res, next) => {
    try {
      const body = leaveRequestInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const employeeId = await targetEmployee(req, ctx, body.employeeId);
        return previewDto(await analyze(ctx, employeeId, body));
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('leave.request.submit'), async (req, res, next) => {
    try {
      const body = leaveRequestInput.parse(req.body);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const employeeId = await targetEmployee(req, ctx, body.employeeId);
        const id = await submitRequest(ctx, engine, auth.userId, employeeId, body);
        return (await baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow()) as unknown;
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me', async (req, res, next) => {
    try {
      const q = leaveRequestListQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx) =>
        listRequests(ctx, q, await employeeOfUser(ctx, (req.auth as { userId: string }).userId)),
      );
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/', requirePermission('leave.request.read_all'), async (req, res, next) => {
    try {
      const q = leaveRequestListQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx) => listRequests(ctx, q));
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        const r = await baseSelect(ctx).where('r.id', '=', id).executeTakeFirst();
        if (!r) throw new AppError('NOT_FOUND', 404, 'الطلب غير موجود');
        let allowed = hasPermission(auth, 'leave.request.read_all');
        if (!allowed) {
          const owner = await ctx.trx
            .selectFrom('employees')
            .select('id')
            .where('id', '=', r.employeeId)
            .where('userId', '=', auth.userId)
            .executeTakeFirst();
          allowed = !!owner;
        }
        if (!allowed && r.approvalRequestId) {
          const a = await ctx.trx
            .selectFrom('approvalRequestAssignees')
            .select('id')
            .where('requestId', '=', r.approvalRequestId)
            .where('userId', '=', auth.userId)
            .executeTakeFirst();
          allowed = !!a;
        }
        if (!allowed) throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية عرض هذا الطلب');
        const days = await ctx.trx
          .selectFrom('leaveRequestDays')
          .select(['dayDate', 'units', 'kind'])
          .where('requestId', '=', id)
          .orderBy('dayDate')
          .execute();
        const approval = r.approvalRequestId
          ? ((await ctx.trx
              .selectFrom('approvalRequests')
              .select(['id', 'status', 'currentPosition'])
              .where('id', '=', r.approvalRequestId)
              .executeTakeFirst()) ?? null)
          : null;
        return { ...r, daysDetail: days, approval };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/cancel', async (req, res, next) => {
    try {
      const { id } = idParam.parse(req.params);
      const { note } = z
        .object({ note: z.string().trim().max(300).nullish() })
        .parse(req.body ?? {});
      const auth = req.auth as NonNullable<Request['auth']>;
      const data = await run(req, async (ctx) => {
        await cancelRequest(
          ctx,
          engine,
          id,
          { userId: auth.userId, canManage: hasPermission(auth, 'leave.request.manage') },
          note,
        );
        return baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post(
    '/:id/override',
    requirePermission('leave.request.manage'),
    async (req, res, next) => {
      try {
        const { id } = idParam.parse(req.params);
        const body = leaveOverrideInput.parse(req.body);
        const auth = req.auth as NonNullable<Request['auth']>;
        const data = await run(req, async (ctx) => {
          await overrideDays(ctx, id, auth.userId, body.days, body.reason);
          return baseSelect(ctx).where('r.id', '=', id).executeTakeFirstOrThrow();
        });
        res.json({ data });
      } catch (err) {
        next(err);
      }
    },
  );

  return router;
};
