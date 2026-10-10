import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import {
  approvalActionInput,
  approvalFlowInput,
  approvalFlowUpdateInput,
  approvalListQuery,
  approvalResubmitInput,
  approvalSubmitInput,
  approvalWithdrawInput,
  delegationInput,
} from '@hrms/shared';
import type { Db } from '../db/index.js';
import { withTenant, type Ctx } from '../db/tenant.js';
import { AppError } from '../shared/errors.js';
import { hasPermission, requirePermission, type AuthContext } from '../modules/identity/index.js';
import type { ApprovalEngine } from './engine.js';
import { getApprovalRequestType, listApprovalRequestTypes } from './registry.js';

const bad = (code: string, message: string, status = 400) => new AppError(code, status, message);
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v))
    throw bad('NOT_FOUND', 'العنصر غير موجود', 404);
  return v;
};

const makeRun =
  (db: Db) =>
  <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };

const REQUEST_COLUMNS = [
  'r.id',
  'r.requestType',
  'r.title',
  'r.status',
  'r.currentPosition',
  'r.requesterUserId',
  'r.entityType',
  'r.entityId',
  'r.finalNote',
  'r.submittedAt',
  'r.decidedAt',
] as const;

const FLOW = 'approvals.flow';

/** مسارات سلاسل الموافقة (للإدارة) ونوعا الطلبات المسجَّلة. */
export const createApprovalFlowsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/request-types', requirePermission(`${FLOW}.read`), (_req, res) => {
    res.json({
      data: listApprovalRequestTypes().map((t) => ({
        key: t.key,
        nameAr: t.nameAr,
        nameEn: t.nameEn ?? null,
        apiSubmittable: !!t.apiSubmittable,
      })),
    });
  });

  const loadFlow = async (ctx: Ctx, id: string) => {
    const flow = await ctx.trx
      .selectFrom('approvalFlows')
      .select([
        'id',
        'code',
        'requestType',
        'nameAr',
        'nameEn',
        'isActive',
        'version',
        'createdAt',
        'updatedAt',
      ])
      .where('companyId', '=', ctx.companyId)
      .where('id', '=', id)
      .executeTakeFirst();
    if (!flow) throw bad('NOT_FOUND', 'السلسلة غير موجودة', 404);
    const steps = await ctx.trx
      .selectFrom('approvalSteps')
      .select([
        'id',
        'position',
        'nameAr',
        'nameEn',
        'approverType',
        'approverRef',
        'mode',
        'condition',
      ])
      .where('flowId', '=', id)
      .orderBy('position')
      .execute();
    return { ...flow, steps };
  };

  const validateSteps = async (
    ctx: Ctx,
    steps: { approverType: string; approverRef?: string | null }[],
  ) => {
    for (const s of steps) {
      if (s.approverType === 'role') {
        const r = await ctx.trx
          .selectFrom('roles')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', s.approverRef as string)
          .executeTakeFirst();
        if (!r) throw bad('INVALID_REFERENCE', 'الدور المحدد كمعتمد غير موجود');
      } else if (s.approverType === 'user') {
        const u = await ctx.trx
          .selectFrom('users')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', s.approverRef as string)
          .executeTakeFirst();
        if (!u) throw bad('INVALID_REFERENCE', 'المستخدم المحدد كمعتمد غير موجود');
      }
    }
  };

  const writeSteps = async (
    ctx: Ctx,
    flowId: string,
    steps: ReturnType<typeof approvalFlowInput.parse>['steps'],
  ) => {
    await ctx.trx.deleteFrom('approvalSteps').where('flowId', '=', flowId).execute();
    await ctx.trx
      .insertInto('approvalSteps')
      .values(
        steps.map((s, i) => ({
          companyId: ctx.companyId,
          flowId,
          position: i + 1,
          nameAr: s.nameAr,
          nameEn: s.nameEn ?? null,
          approverType: s.approverType,
          approverRef: s.approverRef ?? null,
          mode: s.mode,
          condition: s.condition ? JSON.stringify(s.condition) : null,
        })),
      )
      .execute();
  };

  const requireKnownType = (key: string) => {
    if (!getApprovalRequestType(key))
      throw bad('UNKNOWN_REQUEST_TYPE', `نوع الطلب غير معروف: ${key}`);
  };

  const deactivateOthers = (ctx: Ctx, requestType: string, exceptId: string) =>
    ctx.trx
      .updateTable('approvalFlows')
      .set({ isActive: false, version: sql`version + 1` })
      .where('companyId', '=', ctx.companyId)
      .where('requestType', '=', requestType)
      .where('id', '<>', exceptId)
      .where('isActive', '=', true)
      .execute();

  router.get('/', requirePermission(`${FLOW}.read`), async (req, res, next) => {
    try {
      const data = await run(req, async (ctx) => {
        const flows = await ctx.trx
          .selectFrom('approvalFlows as f')
          .select([
            'f.id',
            'f.code',
            'f.requestType',
            'f.nameAr',
            'f.nameEn',
            'f.isActive',
            'f.version',
            sql<number>`(select count(*)::int from approval_steps s where s.flow_id = f.id)`.as(
              'stepCount',
            ),
          ])
          .where('f.companyId', '=', ctx.companyId)
          .orderBy('f.requestType')
          .orderBy('f.code')
          .execute();
        return flows;
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  /** خيارات محرر السلسلة: الأدوار والمستخدمون الفعّالون (دون اشتراط صلاحيات إدارة الأدوار/المستخدمين) */
  router.get('/options', requirePermission(`${FLOW}.manage`), async (req, res, next) => {
    try {
      const data = await run(req, async (ctx) => ({
        roles: await ctx.trx
          .selectFrom('roles')
          .select(['id', 'code', 'nameAr', 'nameEn'])
          .where('companyId', '=', ctx.companyId)
          .orderBy('code')
          .execute(),
        users: await ctx.trx
          .selectFrom('users')
          .select(['id', 'displayName', 'email'])
          .where('companyId', '=', ctx.companyId)
          .where('status', '=', 'active')
          .orderBy('displayName')
          .execute(),
      }));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', requirePermission(`${FLOW}.read`), async (req, res, next) => {
    try {
      const data = await run(req, (ctx) => loadFlow(ctx, idOf(req.params['id'])));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission(`${FLOW}.manage`), async (req, res, next) => {
    try {
      const input = approvalFlowInput.parse(req.body);
      requireKnownType(input.requestType);
      const data = await run(req, async (ctx) => {
        await validateSteps(ctx, input.steps);
        const dup = await ctx.trx
          .selectFrom('approvalFlows')
          .select('id')
          .where('companyId', '=', ctx.companyId)
          .where('code', '=', input.code)
          .executeTakeFirst();
        if (dup) throw bad('CODE_TAKEN', 'رمز السلسلة مستخدم', 409);
        const flow = await ctx.trx
          .insertInto('approvalFlows')
          .values({
            companyId: ctx.companyId,
            code: input.code,
            requestType: input.requestType,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            isActive: false,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await writeSteps(ctx, flow.id, input.steps);
        if (input.isActive) {
          await deactivateOthers(ctx, input.requestType, flow.id);
          await ctx.trx
            .updateTable('approvalFlows')
            .set({ isActive: true })
            .where('id', '=', flow.id)
            .execute();
        }
        return loadFlow(ctx, flow.id);
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.put('/:id', requirePermission(`${FLOW}.manage`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = approvalFlowUpdateInput.parse(req.body);
      requireKnownType(input.requestType);
      const data = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('approvalFlows')
          .select(['version', 'requestType'])
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!cur) throw bad('NOT_FOUND', 'السلسلة غير موجودة', 404);
        if (cur.version !== input.version)
          throw bad('VERSION_CONFLICT', 'عُدّلت السلسلة من مستخدم آخر، أعد التحميل', 409);
        const inFlight = await ctx.trx
          .selectFrom('approvalRequests')
          .select('id')
          .where('flowId', '=', id)
          .where('status', '=', 'pending')
          .limit(1)
          .executeTakeFirst();
        if (inFlight)
          throw bad(
            'FLOW_IN_USE',
            'توجد طلبات قيد الموافقة على هذه السلسلة؛ أنهِها أو انسخ سلسلة جديدة وفعّلها',
            409,
          );
        await validateSteps(ctx, input.steps);
        await ctx.trx
          .updateTable('approvalFlows')
          .set({
            requestType: input.requestType,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
            isActive: false,
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .execute();
        await writeSteps(ctx, id, input.steps);
        if (input.isActive) {
          await deactivateOthers(ctx, input.requestType, id);
          await ctx.trx
            .updateTable('approvalFlows')
            .set({ isActive: true })
            .where('id', '=', id)
            .execute();
        }
        return loadFlow(ctx, id);
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission(`${FLOW}.manage`), async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const used = await ctx.trx
          .selectFrom('approvalRequests')
          .select('id')
          .where('flowId', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (used) throw bad('FLOW_IN_USE', 'للسلسلة طلبات سابقة؛ عطّلها بدلاً من حذفها', 409);
        const r = await ctx.trx
          .deleteFrom('approvalFlows')
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!r.numDeletedRows) throw bad('NOT_FOUND', 'السلسلة غير موجودة', 404);
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/** طلبات الموافقة: التقديم، الصندوق الوارد، القرارات. */
export const createApprovalsRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  const page = (rows: unknown[], total: number, q: { page: number; pageSize: number }) => ({
    data: rows,
    meta: { page: q.page, pageSize: q.pageSize, total },
  });

  const listRequests = async (
    ctx: Ctx,
    q: ReturnType<typeof approvalListQuery.parse>,
    mode: 'inbox' | 'mine' | 'all',
    userId: string,
  ) => {
    const build = () => {
      let b = ctx.trx
        .selectFrom('approvalRequests as r')
        .innerJoin('users as u', 'u.id', 'r.requesterUserId')
        .where('r.companyId', '=', ctx.companyId);
      if (mode === 'mine') b = b.where('r.requesterUserId', '=', userId);
      if (mode === 'inbox')
        b = b
          .where('r.status', '=', 'pending')
          .where((eb) =>
            eb.exists(
              eb
                .selectFrom('approvalRequestAssignees as a')
                .select('a.id')
                .whereRef('a.requestId', '=', 'r.id')
                .whereRef('a.position', '=', 'r.currentPosition')
                .where('a.userId', '=', userId)
                .where('a.status', '=', 'pending'),
            ),
          );
      if (q.status && mode !== 'inbox') b = b.where('r.status', '=', q.status);
      if (q.requestType) b = b.where('r.requestType', '=', q.requestType);
      return b;
    };
    const rows = await build()
      .select([...REQUEST_COLUMNS, 'u.displayName as requesterName'])
      .orderBy('r.submittedAt', 'desc')
      .orderBy('r.id', 'desc')
      .limit(q.pageSize)
      .offset((q.page - 1) * q.pageSize)
      .execute();
    const total = Number(
      (
        await build()
          .select(sql<string>`count(*)`.as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );
    return { rows, total };
  };

  router.get('/inbox', async (req, res, next) => {
    try {
      const q = approvalListQuery.parse(req.query);
      const out = await run(req, (ctx, auth) => listRequests(ctx, q, 'inbox', auth.userId));
      res.json(page(out.rows, out.total, q));
    } catch (err) {
      next(err);
    }
  });

  router.get('/inbox/count', async (req, res, next) => {
    try {
      const out = await run(req, (ctx, auth) =>
        listRequests(ctx, approvalListQuery.parse({ pageSize: 1 }), 'inbox', auth.userId),
      );
      res.json({ data: { count: out.total } });
    } catch (err) {
      next(err);
    }
  });

  router.get('/mine', async (req, res, next) => {
    try {
      const q = approvalListQuery.parse(req.query);
      const out = await run(req, (ctx, auth) => listRequests(ctx, q, 'mine', auth.userId));
      res.json(page(out.rows, out.total, q));
    } catch (err) {
      next(err);
    }
  });

  router.get('/', requirePermission('approvals.request.read_all'), async (req, res, next) => {
    try {
      const q = approvalListQuery.parse(req.query);
      const out = await run(req, (ctx, auth) => listRequests(ctx, q, 'all', auth.userId));
      res.json(page(out.rows, out.total, q));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:id', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const data = await run(req, async (ctx, auth) => {
        const r = await ctx.trx
          .selectFrom('approvalRequests as r')
          .innerJoin('users as u', 'u.id', 'r.requesterUserId')
          .select([...REQUEST_COLUMNS, 'r.payload', 'r.flowId', 'u.displayName as requesterName'])
          .where('r.companyId', '=', ctx.companyId)
          .where('r.id', '=', id)
          .executeTakeFirst();
        if (!r) throw bad('NOT_FOUND', 'الطلب غير موجود', 404);
        const assignees = await ctx.trx
          .selectFrom('approvalRequestAssignees as a')
          .innerJoin('users as u', 'u.id', 'a.userId')
          .select([
            'a.id',
            'a.position',
            'a.userId',
            'u.displayName as userName',
            'a.delegatedFromUserId',
            'a.status',
            'a.actedAt',
          ])
          .where('a.requestId', '=', id)
          .orderBy('a.position')
          .orderBy('a.createdAt')
          .execute();
        const visible =
          r.requesterUserId === auth.userId ||
          assignees.some((a) => a.userId === auth.userId) ||
          hasPermission(auth, 'approvals.request.read_all');
        if (!visible) throw bad('NOT_FOUND', 'الطلب غير موجود', 404);
        const actions = await ctx.trx
          .selectFrom('approvalActions as a')
          .innerJoin('users as u', 'u.id', 'a.actorUserId')
          .select([
            'a.id',
            'a.action',
            'a.position',
            'a.note',
            'a.createdAt',
            'a.actorUserId',
            'u.displayName as actorName',
            'a.onBehalfOfUserId',
          ])
          .where('a.requestId', '=', id)
          .orderBy('a.createdAt')
          .orderBy('a.id')
          .execute();
        const steps = await ctx.trx
          .selectFrom('approvalSteps')
          .select(['id', 'position', 'nameAr', 'nameEn', 'mode'])
          .where('flowId', '=', r.flowId)
          .orderBy('position')
          .execute();
        const canAct = assignees.some(
          (a) =>
            a.userId === auth.userId && a.status === 'pending' && a.position === r.currentPosition,
        );
        return {
          ...r,
          steps,
          assignees,
          actions,
          canAct: r.status === 'pending' && canAct,
          canWithdraw:
            r.requesterUserId === auth.userId &&
            (r.status === 'pending' || r.status === 'returned'),
          canResubmit: r.requesterUserId === auth.userId && r.status === 'returned',
        };
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('approvals.request.submit'), async (req, res, next) => {
    try {
      const input = approvalSubmitInput.parse(req.body);
      const def = getApprovalRequestType(input.requestType);
      if (!def?.apiSubmittable)
        throw bad('TYPE_NOT_SUBMITTABLE', 'هذا النوع يُقدَّم من وحدته المختصة', 403);
      const data = await run(req, (ctx, auth) =>
        engine.submit(ctx, { ...input, requesterUserId: auth.userId }),
      );
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/actions', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = approvalActionInput.parse(req.body);
      const data = await run(req, (ctx, auth) => engine.act(ctx, id, auth.userId, input));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/resubmit', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = approvalResubmitInput.parse(req.body);
      const data = await run(req, (ctx, auth) => engine.resubmit(ctx, id, auth.userId, input));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/:id/withdraw', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      const input = approvalWithdrawInput.parse(req.body ?? {});
      const data = await run(req, (ctx, auth) => engine.withdraw(ctx, id, auth.userId, input.note));
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  return router;
};

/** تفويض الموافقات: لكل مستخدم تفويضاته، ومن يملك approvals.delegation.manage يديرها لغيره. */
export const createDelegationsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);
  const run = makeRun(db);

  router.get('/', async (req, res, next) => {
    try {
      const all = req.query['all'] === 'true';
      const data = await run(req, async (ctx, auth) => {
        if (all && !hasPermission(auth, 'approvals.delegation.manage'))
          throw bad('FORBIDDEN', 'لا تملك صلاحية عرض تفويضات الآخرين', 403);
        let b = ctx.trx
          .selectFrom('approverDelegations as d')
          .innerJoin('users as a', 'a.id', 'd.delegatorUserId')
          .innerJoin('users as b', 'b.id', 'd.delegateUserId')
          .select([
            'd.id',
            'd.delegatorUserId',
            'a.displayName as delegatorName',
            'd.delegateUserId',
            'b.displayName as delegateName',
            'd.validFrom',
            'd.validTo',
            'd.requestType',
            'd.note',
            'd.isActive',
          ])
          .where('d.companyId', '=', ctx.companyId);
        if (!all)
          b = b.where((eb) =>
            eb.or([
              eb('d.delegatorUserId', '=', auth.userId),
              eb('d.delegateUserId', '=', auth.userId),
            ]),
          );
        return b.orderBy('d.validFrom', 'desc').orderBy('d.id', 'desc').execute();
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  /** المستخدمون الفعّالون المتاحون كنواب (الاسم فقط) */
  router.get('/users', async (req, res, next) => {
    try {
      const data = await run(req, async (ctx, auth) =>
        ctx.trx
          .selectFrom('users')
          .select(['id', 'displayName'])
          .where('companyId', '=', ctx.companyId)
          .where('status', '=', 'active')
          .where('id', '<>', auth.userId)
          .orderBy('displayName')
          .execute(),
      );
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', async (req, res, next) => {
    try {
      const input = delegationInput.parse(req.body);
      const data = await run(req, async (ctx, auth) => {
        const delegator = input.delegatorUserId ?? auth.userId;
        if (delegator !== auth.userId && !hasPermission(auth, 'approvals.delegation.manage'))
          throw bad('FORBIDDEN', 'لا تملك صلاحية التفويض نيابة عن غيرك', 403);
        if (delegator === input.delegateUserId)
          throw bad('INVALID_DELEGATE', 'لا يمكن التفويض لنفسك');
        const users = await ctx.trx
          .selectFrom('users')
          .select(['id', 'status'])
          .where('companyId', '=', ctx.companyId)
          .where('id', 'in', [delegator, input.delegateUserId])
          .execute();
        if (users.length !== 2) throw bad('INVALID_REFERENCE', 'المستخدم غير موجود');
        if (users.find((u) => u.id === input.delegateUserId)?.status !== 'active')
          throw bad('INVALID_DELEGATE', 'النائب غير فعّال');
        if (input.requestType && !getApprovalRequestType(input.requestType))
          throw bad('UNKNOWN_REQUEST_TYPE', `نوع الطلب غير معروف: ${input.requestType}`);
        return ctx.trx
          .insertInto('approverDelegations')
          .values({
            companyId: ctx.companyId,
            delegatorUserId: delegator,
            delegateUserId: input.delegateUserId,
            validFrom: input.validFrom,
            validTo: input.validTo,
            requestType: input.requestType ?? null,
            note: input.note ?? null,
          })
          .returning(['id', 'delegatorUserId', 'delegateUserId', 'validFrom', 'validTo'])
          .executeTakeFirstOrThrow();
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', async (req, res, next) => {
    try {
      const id = idOf(req.params['id']);
      await run(req, async (ctx, auth) => {
        const d = await ctx.trx
          .selectFrom('approverDelegations')
          .select('delegatorUserId')
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .executeTakeFirst();
        if (!d) throw bad('NOT_FOUND', 'التفويض غير موجود', 404);
        if (
          d.delegatorUserId !== auth.userId &&
          !hasPermission(auth, 'approvals.delegation.manage')
        )
          throw bad('FORBIDDEN', 'لا تملك صلاحية إلغاء هذا التفويض', 403);
        await ctx.trx
          .updateTable('approverDelegations')
          .set({ isActive: false })
          .where('id', '=', id)
          .execute();
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
