import { Router, type Request, type RequestHandler } from 'express';
import { z } from 'zod';
import { csvList, type ApiEnvelope } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { ensureRefsExist } from '../org/index.js';
import { adjust, balancesOf } from './ledger.js';
import { balanceReport } from './reports.js';

const uuid = z.string().uuid();
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

const adjustmentInput = z.object({
  employeeId: uuid,
  leaveTypeId: uuid,
  /** موجب = إضافة، سالب = خصم */
  days: z
    .number()
    .min(-999.99)
    .max(999.99)
    .refine((n) => Math.round(n * 100) !== 0, 'التعديل لا يمكن أن يكون صفراً'),
  reason: z.string().trim().min(1).max(300),
  effectiveDate: isoDate.optional(),
  expiresOn: isoDate.nullish(),
});

const ledgerQuery = z.object({
  employeeId: uuid.optional(),
  leaveTypeId: uuid.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(200).default(50),
});

const reportQuery = z.object({
  leaveTypeId: csvList(uuid),
  departmentId: csvList(uuid),
  branchId: csvList(uuid),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(500).default(50),
});

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

const ledgerPage = async (
  ctx: Ctx,
  employeeId: string,
  q: { leaveTypeId?: string | undefined; page: number; pageSize: number },
) => {
  let b = ctx.trx
    .selectFrom('leaveLedger')
    .select([
      'id',
      'leaveTypeId',
      'entryType',
      'days',
      'effectiveDate',
      'expiresOn',
      'period',
      'requestId',
      'reason',
      'createdAt',
    ])
    .where('companyId', '=', ctx.companyId)
    .where('employeeId', '=', employeeId);
  let c = ctx.trx
    .selectFrom('leaveLedger')
    .select((eb) => eb.fn.countAll<string>().as('n'))
    .where('companyId', '=', ctx.companyId)
    .where('employeeId', '=', employeeId);
  if (q.leaveTypeId) {
    b = b.where('leaveTypeId', '=', q.leaveTypeId);
    c = c.where('leaveTypeId', '=', q.leaveTypeId);
  }
  const rows = await b
    .orderBy('effectiveDate', 'desc')
    .orderBy('id', 'desc')
    .limit(q.pageSize)
    .offset((q.page - 1) * q.pageSize)
    .execute();
  const total = Number((await c.executeTakeFirstOrThrow()).n);
  return { rows, total };
};

/** الأرصدة والدفتر والتعديلات اليدوية. */
export const createBalancesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = <T>(req: Request, fn: (ctx: Ctx, userId: string) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth.userId),
    );
  };
  router.use(authenticate);

  // أرصدتي (أي مستخدم مرتبط بموظف)
  router.get('/me', async (req, res, next) => {
    try {
      const data = await run(req, async (ctx, userId) =>
        balancesOf(ctx, await employeeOfUser(ctx, userId)),
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/me/ledger', async (req, res, next) => {
    try {
      const q = ledgerQuery.parse(req.query);
      const { rows, total } = await run(req, async (ctx, userId) =>
        ledgerPage(ctx, await employeeOfUser(ctx, userId), q),
      );
      const body: ApiEnvelope<typeof rows> = {
        data: rows,
        meta: { page: q.page, pageSize: q.pageSize, total },
      };
      res.json(body);
    } catch (err) {
      next(err);
    }
  });

  router.get('/', requirePermission('leave.balance.read'), async (req, res, next) => {
    try {
      const { employeeId } = z.object({ employeeId: uuid }).parse(req.query);
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [employeeId]);
        return balancesOf(ctx, employeeId);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/report', requirePermission('leave.balance.read'), async (req, res, next) => {
    try {
      const q = reportQuery.parse(req.query);
      const { rows, total } = await run(req, (ctx) => balanceReport(ctx, q));
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/ledger', requirePermission('leave.balance.read'), async (req, res, next) => {
    try {
      const q = ledgerQuery.parse(req.query);
      if (!q.employeeId) throw new AppError('VALIDATION_ERROR', 400, 'employeeId مطلوب');
      const employeeId = q.employeeId;
      const { rows, total } = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'employees', [employeeId]);
        return ledgerPage(ctx, employeeId, q);
      });
      res.json({ data: rows, meta: { page: q.page, pageSize: q.pageSize, total } });
    } catch (err) {
      next(err);
    }
  });

  router.post('/adjustments', requirePermission('leave.balance.adjust'), async (req, res, next) => {
    try {
      const body = adjustmentInput.parse(req.body);
      const data = await run(req, async (ctx, userId) => {
        await ensureRefsExist(ctx, 'employees', [body.employeeId]);
        await ensureRefsExist(ctx, 'leaveTypes', [body.leaveTypeId]);
        await adjust(ctx, { ...body, userId });
        return (await balancesOf(ctx, body.employeeId)).find(
          (b) => b.leaveTypeId === body.leaveTypeId,
        );
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
};
