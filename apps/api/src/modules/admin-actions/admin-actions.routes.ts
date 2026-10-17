import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  adminActionInput,
  adminActionListQuery,
  adminActionTypeInput,
  adminActionTypeUpdate,
  adminActionUpdate,
  cancelActionInput,
  typeRulesError,
} from '@hrms/shared';
import type { ApprovalEngine } from '../../approvals/index.js';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import type { Notifier } from '../../notifications/index.js';
import { AppError } from '../../shared/errors.js';
import { parseSort } from '../../shared/sort.js';
import { assertEmployeeVisible, employeeScope } from '../employees/index.js';
import { hasPermission, requirePermission, type AuthContext } from '../identity/index.js';
import {
  cancelAction,
  createAction,
  escalationSuggestion,
  loadAction,
  loadType,
  setAdminActionNotifier,
  submitAction,
  validateForType,
} from './service.js';

const P = 'admin_actions';
const T_READ = `${P}.type.read`;
const A_READ = `${P}.action.read`;
const A_CREATE = `${P}.action.create`;
const A_PROPOSE = `${P}.action.propose`;
const A_CANCEL = `${P}.action.cancel`;
const uuid = z.string().uuid();
const idParam = z.object({ id: uuid });
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const bad = (code: string, message: string, status = 400) => new AppError(code, status, message);
const isFk = (e: unknown) => (e as { code?: string }).code === '23503';
const isUnique = (e: unknown) => (e as { code?: string }).code === '23505';

/** الأنواع الافتراضية (تُنشأ عند الطلب إن لم توجد): الأبعد تصعيداً أولاً لأن كل نوع يشير إلى التالي */
const DEFAULT_TYPES = [
  { code: 'warning_final', ar: 'إنذار نهائي', en: 'Final warning', cat: 'warning', approval: true },
  {
    code: 'warning_written',
    ar: 'إنذار كتابي',
    en: 'Written warning',
    cat: 'warning',
    approval: true,
    next: { code: 'warning_final', count: 2, days: 365 },
  },
  {
    code: 'notice_verbal',
    ar: 'تنبيه شفهي',
    en: 'Verbal notice',
    cat: 'notice',
    approval: false,
    next: { code: 'warning_written', count: 3, days: 180 },
  },
  {
    code: 'penalty_deduction',
    ar: 'خصم من الراتب',
    en: 'Salary deduction',
    cat: 'penalty',
    approval: true,
    effect: 'deduction',
  },
  {
    code: 'penalty_suspension',
    ar: 'إيقاف عن العمل',
    en: 'Suspension',
    cat: 'penalty',
    approval: true,
  },
  {
    code: 'reward_cash',
    ar: 'مكافأة نقدية',
    en: 'Cash reward',
    cat: 'reward_cash',
    approval: true,
    effect: 'bonus',
  },
  {
    code: 'reward_moral',
    ar: 'مكافأة معنوية',
    en: 'Moral reward',
    cat: 'reward_moral',
    approval: false,
  },
  {
    code: 'commendation',
    ar: 'كتاب شكر وتقدير',
    en: 'Commendation',
    cat: 'commendation',
    approval: false,
  },
  { code: 'promotion', ar: 'ترقية', en: 'Promotion', cat: 'promotion', approval: true },
] as const;

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

type Row = Record<string, unknown>;

/** أنواع الإجراءات: قائمة صغيرة بلا ترقيم، مع إنشاء الأنواع الافتراضية */
export const createAdminActionTypesRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/',
    requirePermission(T_READ),
    wrap(async (req, res) => {
      const q = z
        .object({
          isActive: z.enum(['true', 'false']).optional(),
          q: z.string().max(100).optional(),
        })
        .parse(req.query);
      const rows = await run(req, async (ctx) => {
        let b = ctx.trx
          .selectFrom('adminActionTypes')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .orderBy('category')
          .orderBy('code');
        if (q.isActive) b = b.where('isActive', '=', q.isActive === 'true');
        if (q.q) {
          const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
          b = b.where((eb) =>
            eb.or([
              eb('nameAr', 'ilike', like),
              eb('nameEn', 'ilike', like),
              eb('code', 'ilike', like),
            ]),
          );
        }
        return b.execute();
      });
      res.json({ data: rows, meta: { page: 1, pageSize: rows.length, total: rows.length } });
    }),
  );

  router.post(
    '/defaults',
    requirePermission(`${P}.type.create`),
    wrap(async (req, res) => {
      const created = await run(req, async (ctx) => {
        const ids = new Map<string, string>();
        let n = 0;
        for (const t of DEFAULT_TYPES) {
          const existing = await ctx.trx
            .selectFrom('adminActionTypes')
            .select('id')
            .where('companyId', '=', ctx.companyId)
            .where('code', '=', t.code)
            .executeTakeFirst();
          if (existing) {
            ids.set(t.code, existing.id);
            continue;
          }
          const next = 'next' in t ? t.next : null;
          const row = await ctx.trx
            .insertInto('adminActionTypes')
            .values({
              companyId: ctx.companyId,
              code: t.code,
              nameAr: t.ar,
              nameEn: t.en,
              category: t.cat,
              payrollEffect: 'effect' in t ? t.effect : 'none',
              requiresApproval: t.approval,
              escalationTypeId: next ? (ids.get(next.code) ?? null) : null,
              escalationCount: next ? next.count : null,
              escalationWindowDays: next ? next.days : null,
              letterTemplateCode: null,
            })
            .returning('id')
            .executeTakeFirstOrThrow();
          ids.set(t.code, row.id);
          n += 1;
        }
        return n;
      });
      res.status(201).json({ data: { created } });
    }),
  );

  router.post(
    '/',
    requirePermission(`${P}.type.create`),
    wrap(async (req, res) => {
      const b = adminActionTypeInput.parse(req.body);
      const row = await run(req, async (ctx) => {
        try {
          return await ctx.trx
            .insertInto('adminActionTypes')
            .values({
              companyId: ctx.companyId,
              code: b.code,
              nameAr: b.nameAr,
              nameEn: b.nameEn ?? null,
              category: b.category,
              payrollEffect: b.payrollEffect,
              requiresApproval: b.requiresApproval,
              requiresAcknowledgment: b.requiresAcknowledgment,
              letterTemplateCode: b.letterTemplateCode ?? null,
              escalationTypeId: b.escalationTypeId ?? null,
              escalationCount: b.escalationCount ?? null,
              escalationWindowDays: b.escalationWindowDays ?? null,
              isActive: b.isActive,
            })
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch (e) {
          if (isUnique(e)) throw bad('DUPLICATE_CODE', 'الرمز مستخدم لنوع آخر', 409);
          if (isFk(e)) throw bad('INVALID_REFERENCE', 'نوع التصعيد غير موجود');
          throw e;
        }
      });
      res.status(201).json({ data: row });
    }),
  );

  router.patch(
    '/:id',
    requirePermission(`${P}.type.update`),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const b = adminActionTypeUpdate.parse(req.body);
      const row = await run(req, async (ctx) => {
        const cur = await ctx.trx
          .selectFrom('adminActionTypes')
          .selectAll()
          .where('companyId', '=', ctx.companyId)
          .where('id', '=', id)
          .forUpdate()
          .executeTakeFirst();
        if (!cur) throw new AppError('NOT_FOUND', 404, 'النوع غير موجود');
        if (cur.version !== b.version)
          throw bad('VERSION_CONFLICT', 'عُدّل السجل من مستخدم آخر؛ أعد التحميل', 409);
        const { version, ...patch } = b;
        void version;
        const merged = {
          ...cur,
          ...Object.fromEntries(Object.entries(patch).filter(([, v]) => v !== undefined)),
        };
        const err = typeRulesError(merged as never);
        if (err) throw bad('VALIDATION_ERROR', err);
        if (merged.escalationTypeId === id)
          throw bad('INVALID_ESCALATION', 'لا يُصعَّد النوع إلى نفسه');
        try {
          return await ctx.trx
            .updateTable('adminActionTypes')
            .set({ ...patch, version: sql`version + 1` } as never)
            .where('id', '=', id)
            .returningAll()
            .executeTakeFirstOrThrow();
        } catch (e) {
          if (isUnique(e)) throw bad('DUPLICATE_CODE', 'الرمز مستخدم لنوع آخر', 409);
          if (isFk(e)) throw bad('INVALID_REFERENCE', 'نوع التصعيد غير موجود');
          throw e;
        }
      });
      res.json({ data: row });
    }),
  );

  router.delete(
    '/:id',
    requirePermission(`${P}.type.delete`),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      await run(req, async (ctx) => {
        try {
          const r = await ctx.trx
            .deleteFrom('adminActionTypes')
            .where('companyId', '=', ctx.companyId)
            .where('id', '=', id)
            .executeTakeFirst();
          if (!r.numDeletedRows) throw new AppError('NOT_FOUND', 404, 'النوع غير موجود');
        } catch (e) {
          if (isFk(e))
            throw bad('TYPE_IN_USE', 'النوع مستخدم في إجراءات أو تصعيد؛ عطّله بدل حذفه', 409);
          throw e;
        }
      });
      res.status(204).end();
    }),
  );
  return router;
};

const SORT: Record<string, string> = {
  createdAt: 'a.created_at',
  actionDate: 'a.action_date',
  effectiveDate: 'a.effective_date',
  status: 'a.status',
  employee: 'employees.full_name_ar',
  employeeNo: 'employees.employee_no',
  type: 't.name_ar',
  amount: 'a.amount',
};

const LIST_COLS = sql`
  a.id, a.employee_id, employees.employee_no, employees.full_name_ar as employee_name,
  a.type_id, t.code as type_code, t.name_ar as type_name, t.category, t.payroll_effect,
  t.requires_acknowledgment, a.status, a.title, a.action_date::text as action_date,
  a.effective_date::text as effective_date, a.amount::text as amount, a.currency,
  a.payroll_year, a.payroll_month, a.applied_period_id, a.approval_request_id,
  a.issued_document_id, a.acknowledged_at, a.created_at, a.version`;

export const createAdminActionsRouter = (
  db: Db,
  authenticate: RequestHandler,
  engine: ApprovalEngine,
  notifier: Notifier,
): Router => {
  setAdminActionNotifier(notifier);
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  const actorOf = (auth: AuthContext) => ({
    userId: auth.userId,
    canCreate: hasPermission(auth, A_CREATE),
  });
  const writePerm = (auth: AuthContext): string => {
    if (hasPermission(auth, A_CREATE)) return A_CREATE;
    if (hasPermission(auth, A_PROPOSE)) return A_PROPOSE;
    throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية إنشاء إجراء إداري');
  };

  router.get(
    '/',
    requirePermission(A_READ),
    wrap(async (req, res) => {
      const q = adminActionListQuery.parse(req.query);
      const auth = req.auth as AuthContext;
      const out = await run(req, async (ctx) => {
        const srt = parseSort(q.sort, SORT, '-createdAt');
        const scope = employeeScope(auth, A_READ);
        const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
        const where = sql`a.company_id = ${ctx.companyId}
          ${scope ? sql`and ${scope}` : sql``}
          ${q.employeeId ? sql`and a.employee_id = ${q.employeeId}` : sql``}
          ${q.typeId ? sql`and a.type_id = ${q.typeId}` : sql``}
          ${q.category ? sql`and t.category = ${q.category}` : sql``}
          ${q.status ? sql`and a.status = ${q.status}` : sql``}
          ${like ? sql`and (a.title ilike ${like} or employees.full_name_ar ilike ${like} or employees.employee_no ilike ${like})` : sql``}`;
        const from = sql`from admin_actions a join employees on employees.id = a.employee_id
          join admin_action_types t on t.id = a.type_id`;
        const total = await sql<{
          n: number;
        }>`select count(*)::int as n ${from} where ${where}`.execute(ctx.trx);
        const { rows } = await sql<Row>`select ${LIST_COLS} ${from} where ${where}
          order by ${sql.raw(srt.column)} ${sql.raw(srt.desc ? 'desc' : 'asc')}, a.id desc
          limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
        return { rows, total: total.rows[0]!.n };
      });
      res.json({ data: out.rows, meta: { page: q.page, pageSize: q.pageSize, total: out.total } });
    }),
  );

  router.get(
    '/suggest',
    requirePermission(A_READ),
    wrap(async (req, res) => {
      const q = z.object({ employeeId: uuid, typeId: uuid }).parse(req.query);
      const auth = req.auth as AuthContext;
      const data = await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, q.employeeId, A_READ);
        return escalationSuggestion(ctx, q.employeeId, q.typeId);
      });
      res.json({ data });
    }),
  );

  router.get(
    '/:id',
    requirePermission(A_READ),
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as AuthContext;
      const data = await run(req, async (ctx) => {
        const scope = employeeScope(auth, A_READ);
        const { rows } =
          await sql<Row>`select ${LIST_COLS}, a.description, a.promotion, a.cancel_reason,
            a.decided_at, a.employment_change_id, a.salary_id, a.created_by, t.letter_template_code
          from admin_actions a join employees on employees.id = a.employee_id
          join admin_action_types t on t.id = a.type_id
         where a.company_id = ${ctx.companyId} and a.id = ${id} ${scope ? sql`and ${scope}` : sql``}`.execute(
            ctx.trx,
          );
        if (!rows[0]) throw new AppError('NOT_FOUND', 404, 'الإجراء غير موجود');
        return rows[0];
      });
      res.json({ data });
    }),
  );

  router.post(
    '/',
    wrap(async (req, res) => {
      const auth = req.auth as AuthContext;
      const perm = writePerm(auth);
      const b = adminActionInput.parse(req.body);
      const out = await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, b.employeeId, perm);
        const id = await createAction(ctx, engine, actorOf(auth), b);
        const a = await loadAction(ctx, id);
        const suggestion = await escalationSuggestion(ctx, b.employeeId, b.typeId);
        return { id, status: a.status, suggestion };
      });
      res.status(201).json({ data: out });
    }),
  );

  router.patch(
    '/:id',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as AuthContext;
      const perm = writePerm(auth);
      const b = adminActionUpdate.parse(req.body);
      await run(req, async (ctx) => {
        const a = await loadAction(ctx, id, true);
        await assertEmployeeVisible(ctx, auth, a.employeeId, perm);
        if (a.status !== 'draft')
          throw bad('NOT_DRAFT', 'يُعدَّل الإجراء في حالة المسودة فقط', 409);
        if (a.version !== b.version)
          throw bad('VERSION_CONFLICT', 'عُدّل السجل من مستخدم آخر؛ أعد التحميل', 409);
        const own = await ctx.trx
          .selectFrom('adminActions')
          .select('createdBy')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        if (own.createdBy !== auth.userId && !hasPermission(auth, A_CREATE))
          throw bad('FORBIDDEN', 'مسودات الآخرين لا يعدّلها إلا من يملك صلاحية الإنشاء', 403);
        const type = await loadType(ctx, a.typeId);
        const eff = b.effectiveDate ?? a.effectiveDate;
        const amount = b.amount === undefined ? a.amount : b.amount;
        const currency = b.currency === undefined ? a.currency : b.currency;
        const promotion = b.promotion === undefined ? a.promotion : b.promotion;
        await validateForType(ctx, type, {
          employeeId: a.employeeId,
          effectiveDate: eff,
          amount,
          currency,
          promotion,
        });
        const year = b.payrollYear ?? undefined;
        await ctx.trx
          .updateTable('adminActions')
          .set({
            ...(b.title !== undefined ? { title: b.title } : {}),
            ...(b.description !== undefined ? { description: b.description } : {}),
            ...(b.actionDate !== undefined ? { actionDate: b.actionDate } : {}),
            effectiveDate: eff,
            amount,
            currency,
            promotion: promotion ? JSON.stringify(promotion) : null,
            ...(type.payrollEffect !== 'none'
              ? {
                  payrollYear: year ?? Number(eff.slice(0, 4)),
                  payrollMonth: b.payrollMonth ?? Number(eff.slice(5, 7)),
                }
              : {}),
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .execute();
      });
      res.json({ data: { id } });
    }),
  );

  router.post(
    '/:id/submit',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as AuthContext;
      const perm = writePerm(auth);
      const status = await run(req, async (ctx) => {
        const a = await loadAction(ctx, id);
        await assertEmployeeVisible(ctx, auth, a.employeeId, perm);
        return submitAction(ctx, engine, actorOf(auth), id);
      });
      res.json({ data: { id, status } });
    }),
  );

  router.post(
    '/:id/cancel',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as AuthContext;
      const b = cancelActionInput.parse(req.body);
      await run(req, async (ctx) => {
        const a = await loadAction(ctx, id);
        const canCancel = hasPermission(auth, A_CANCEL);
        const own = await ctx.trx
          .selectFrom('adminActions')
          .select('createdBy')
          .where('id', '=', id)
          .executeTakeFirstOrThrow();
        if (!canCancel && !(own.createdBy === auth.userId && a.status !== 'approved'))
          throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية إلغاء هذا الإجراء');
        await assertEmployeeVisible(
          ctx,
          auth,
          a.employeeId,
          canCancel ? A_CANCEL : writePerm(auth),
        );
        await cancelAction(ctx, engine, auth, id, b.reason);
      });
      res.json({ data: { id } });
    }),
  );

  return router;
};

/** سجلاتي الإدارية: للموظف المرتبط بحسابه فقط، المعتمدة منها، مع إقرار الاستلام */
export const createMyAdminActionsRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/',
    wrap(async (req, res) => {
      const auth = req.auth as AuthContext;
      const rows = await run(req, async (ctx) => {
        const { rows } = await sql<Row>`
          select a.id, t.name_ar as type_name, t.name_en as type_name_en, t.category,
                 t.requires_acknowledgment, a.title, a.description, a.action_date::text as action_date,
                 a.effective_date::text as effective_date, a.amount::text as amount, a.currency,
                 a.acknowledged_at, a.decided_at
            from admin_actions a
            join employees e on e.id = a.employee_id
            join admin_action_types t on t.id = a.type_id
           where a.company_id = ${ctx.companyId} and e.user_id = ${auth.userId} and a.status = 'approved'
           order by a.action_date desc, a.id desc`.execute(ctx.trx);
        return rows;
      });
      res.json({ data: rows, meta: { total: rows.length } });
    }),
  );

  router.post(
    '/:id/acknowledge',
    wrap(async (req, res) => {
      const { id } = idParam.parse(req.params);
      const auth = req.auth as AuthContext;
      await run(req, async (ctx) => {
        const { rows } = await sql<{ id: string; acknowledgedAt: Date | null; req: boolean }>`
          select a.id, a.acknowledged_at, t.requires_acknowledgment as req
            from admin_actions a
            join employees e on e.id = a.employee_id
            join admin_action_types t on t.id = a.type_id
           where a.company_id = ${ctx.companyId} and a.id = ${id} and e.user_id = ${auth.userId}
             and a.status = 'approved' for update of a`.execute(ctx.trx);
        const a = rows[0];
        if (!a) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
        if (!a.req) throw bad('ACK_NOT_REQUIRED', 'لا يتطلب هذا الإجراء إقراراً', 409);
        if (a.acknowledgedAt) return;
        await ctx.trx
          .updateTable('adminActions')
          .set({
            acknowledgedAt: new Date(),
            acknowledgedBy: auth.userId,
            version: sql`version + 1`,
          })
          .where('id', '=', id)
          .execute();
      });
      res.json({ data: { id, acknowledged: true } });
    }),
  );
  return router;
};
