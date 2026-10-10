import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import { leaveAssignmentInput } from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { requirePermission } from '../identity/index.js';
import { ensureRefsExist } from '../org/index.js';

const SCOPE_TABLE = {
  branch: 'branches',
  department: 'departments',
  employee: 'employees',
} as const;

/**
 * السياسة السارية لموظف ونوع إجازة في تاريخ معيّن.
 * الأخص يغلب: موظف ← قسم ← فرع ← شركة. تُتجاهل السياسات المعطلة.
 */
export const resolvePolicy = async (
  ctx: Ctx,
  employeeId: string,
  leaveTypeId: string,
  onDate: string,
): Promise<{ policyId: string; scope: string } | null> => {
  const { rows } = await sql<{ policyId: string; scope: string }>`
    select a.policy_id as "policyId", a.scope
    from leave_policy_assignments a
    join leave_policies p on p.id = a.policy_id and p.is_active
    left join employments e on e.employee_id = ${employeeId}
      and e.valid_from <= ${onDate}::date and (e.valid_to is null or e.valid_to >= ${onDate}::date)
    where a.company_id = ${ctx.companyId}
      and p.leave_type_id = ${leaveTypeId}
      and a.valid_from <= ${onDate}::date
      and (
        a.scope = 'company'
        or (a.scope = 'employee' and a.scope_ref = ${employeeId})
        or (a.scope = 'department' and a.scope_ref = e.department_id)
        or (a.scope = 'branch' and a.scope_ref = e.branch_id)
      )
    order by case a.scope when 'employee' then 1 when 'department' then 2 when 'branch' then 3 else 4 end,
             a.valid_from desc
    limit 1`.execute(ctx.trx);
  return rows[0] ?? null;
};

const stripCompany = <T extends { companyId: string }>(row: T): Omit<T, 'companyId'> => {
  const rest: Partial<T> = { ...row };
  delete rest.companyId;
  return rest as Omit<T, 'companyId'>;
};

const listQ = z.object({ policyId: z.string().uuid().optional() });

export const createAssignmentsRouter = (db: Db, authenticate: RequestHandler): Router => {
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

  router.get('/', requirePermission('leave.policy.read'), async (req, res, next) => {
    try {
      const q = listQ.parse(req.query);
      const data = await run(req, async (ctx) => {
        let b = ctx.trx.selectFrom('leavePolicyAssignments').selectAll();
        if (q.policyId) b = b.where('policyId', '=', q.policyId);
        const rows = await b.orderBy('createdAt').execute();
        return rows.map((r) => stripCompany(r));
      });
      res.json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.post('/', requirePermission('leave.policy.create'), async (req, res, next) => {
    try {
      const body = leaveAssignmentInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        await ensureRefsExist(ctx, 'leavePolicies', [body.policyId]);
        if (body.scope !== 'company' && body.scopeRef) {
          await ensureRefsExist(ctx, SCOPE_TABLE[body.scope], [body.scopeRef]);
        }
        try {
          const row = await ctx.trx
            .insertInto('leavePolicyAssignments')
            .values({
              companyId: ctx.companyId,
              policyId: body.policyId,
              scope: body.scope,
              scopeRef: body.scopeRef ?? null,
              ...(body.validFrom ? { validFrom: body.validFrom } : {}),
            })
            .returningAll()
            .executeTakeFirstOrThrow();
          return stripCompany(row);
        } catch (err) {
          if ((err as { code?: string }).code === '23505') {
            throw new AppError('DUPLICATE', 409, 'هذا التعيين موجود مسبقاً');
          }
          throw err;
        }
      });
      res.status(201).json({ data });
    } catch (err) {
      next(err);
    }
  });

  router.delete('/:id', requirePermission('leave.policy.delete'), async (req, res, next) => {
    try {
      const id = z.string().uuid().parse(req.params['id']);
      await run(req, async (ctx) => {
        const r = await ctx.trx
          .deleteFrom('leavePolicyAssignments')
          .where('id', '=', id)
          .executeTakeFirst();
        if (r.numDeletedRows === 0n) throw new AppError('NOT_FOUND', 404, 'السجل غير موجود');
      });
      res.status(204).end();
    } catch (err) {
      next(err);
    }
  });

  return router;
};
