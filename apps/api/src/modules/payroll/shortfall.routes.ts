import { Router, type Request, type RequestHandler, type Response } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  shortfallDecisionInput,
  shortfallPolicyInput,
  shortfallReportQuery,
  type ShortfallPolicy,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { assertEmployeeVisible, employeeScope } from '../employees/index.js';
import { requirePermission, type AuthContext } from '../identity/index.js';
import { monthRange, recalcEmployee, type Period } from './calc.js';
import { evaluateShortfall, loadPolicy } from './shortfall.js';
import { makeRun } from './setup.routes.js';

type Row = Record<string, unknown>;
const wrap =
  (fn: (req: Request, res: Response) => Promise<void>): RequestHandler =>
  (req, res, next) => {
    fn(req, res).catch(next);
  };
const S = 'payroll.shortfall';

const DEFAULT_POLICY: ShortfallPolicy = {
  isEnabled: false,
  method: 'minutes',
  countLate: true,
  countEarly: true,
  monthlyFreeMinutes: 0,
  minutesPerDay: 480,
  tiers: [],
  defaultTarget: 'salary',
  leaveTypeId: null,
  suggestActionAfter: null,
};

/** القرار يتغير ما دامت قسائم الشهر في مسودة؛ بعد الاعتماد يلزم إعادة فتح الدورة. */
const assertMonthOpen = async (ctx: Ctx, employeeId: string, year: number, month: number) => {
  const { rows } = await sql<Row>`
    select p.status from payslips s join payroll_periods p on p.id = s.period_id
     where s.company_id = ${ctx.companyId} and s.employee_id = ${employeeId}
       and p.year = ${year} and p.month = ${month} and p.status <> 'draft' limit 1`.execute(
    ctx.trx,
  );
  if (rows[0])
    throw new AppError(
      'PERIOD_LOCKED',
      409,
      'قسيمة الموظف لهذا الشهر في دورة معتمدة أو مقفلة؛ أعد فتح الدورة أولاً',
    );
};

const recalcDrafts = async (ctx: Ctx, employeeId: string, year: number, month: number) => {
  const { rows } = await sql<Row>`
    select distinct p.id, p.pay_group_id, p.year, p.month, p.start_date::text as start_date,
           p.end_date::text as end_date, p.currency, p.status
      from payslips s join payroll_periods p on p.id = s.period_id
     where s.company_id = ${ctx.companyId} and s.employee_id = ${employeeId}
       and p.year = ${year} and p.month = ${month} and p.status = 'draft'`.execute(ctx.trx);
  for (const r of rows) await recalcEmployee(ctx, r as unknown as Period, employeeId);
};

export const createShortfallRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);

  router.get(
    '/policy',
    requirePermission(`${S}.read`),
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => (await loadPolicy(ctx)) ?? { ...DEFAULT_POLICY });
      res.json({ data });
    }),
  );

  router.put(
    '/policy',
    requirePermission(`${S}.policy`),
    wrap(async (req, res) => {
      const b = shortfallPolicyInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        if (b.leaveTypeId) {
          const t = await ctx.trx
            .selectFrom('leaveTypes')
            .select('id')
            .where('id', '=', b.leaveTypeId)
            .executeTakeFirst();
          if (!t) throw new AppError('VALIDATION', 400, 'نوع الإجازة غير موجود');
        }
        const cur = await loadPolicy(ctx);
        const vals = {
          isEnabled: b.isEnabled,
          method: b.method,
          countLate: b.countLate,
          countEarly: b.countEarly,
          monthlyFreeMinutes: b.monthlyFreeMinutes,
          minutesPerDay: b.minutesPerDay,
          tiers: JSON.stringify(b.tiers),
          defaultTarget: b.defaultTarget,
          leaveTypeId: b.leaveTypeId,
          suggestActionAfter: b.suggestActionAfter,
        };
        if (!cur) {
          await ctx.trx
            .insertInto('shortfallPolicies')
            .values({ companyId: ctx.companyId, ...vals })
            .execute();
        } else {
          if (b.version !== undefined && b.version !== cur.version)
            throw new AppError('VERSION_CONFLICT', 409, 'تغيّرت السياسة؛ أعد التحميل');
          await ctx.trx
            .updateTable('shortfallPolicies')
            .set({ ...vals, version: sql`version + 1` })
            .where('companyId', '=', ctx.companyId)
            .execute();
        }
        return (await loadPolicy(ctx))!;
      });
      res.json({ data });
    }),
  );

  router.get(
    '/report',
    requirePermission(`${S}.read`),
    wrap(async (req, res) => {
      const q = shortfallReportQuery.parse(req.query);
      const auth = req.auth as AuthContext;
      const out = await run(req, async (ctx) => {
        const policy = await loadPolicy(ctx);
        const range = monthRange(q.year, q.month);
        const scope = employeeScope(auth, `${S}.read`);
        const like = q.q ? `%${q.q.replace(/[%_\\]/g, '\\$&')}%` : null;
        const curEmp = sql`exists (select 1 from employments cur where cur.employee_id = employees.id
          and cur.valid_from <= ${range.endDate}::date and (cur.valid_to is null or cur.valid_to >= ${range.endDate}::date)
          ${q.branchId?.length ? sql`and cur.branch_id = any(${q.branchId}::uuid[])` : sql``}
          ${q.departmentId?.length ? sql`and cur.department_id = any(${q.departmentId}::uuid[])` : sql``})`;
        const filtered = !!(q.branchId?.length || q.departmentId?.length);
        const { rows: cand } = await sql<Row>`
          select employees.id from employees
           where employees.company_id = ${ctx.companyId}
             ${scope ? sql`and ${scope}` : sql``}
             ${filtered ? sql`and ${curEmp}` : sql``}
             ${like ? sql`and (employees.full_name_ar ilike ${like} or employees.employee_no ilike ${like})` : sql``}
             and (exists (select 1 from attendance_days d where d.employee_id = employees.id
                    and d.day_date between ${range.startDate}::date and ${range.endDate}::date
                    and (d.late_minutes > 0 or d.early_leave_minutes > 0))
               or exists (select 1 from shortfall_decisions sd where sd.employee_id = employees.id
                    and sd.year = ${q.year} and sd.month = ${q.month}))`.execute(ctx.trx);
        const ids = cand.map((r) => r.id as string);
        // التقرير يعرض الاحتساب حتى لو السياسة معطّلة (للاطلاع)، مع علم التفعيل
        const evals = await evaluateShortfall(
          ctx,
          { ...q, ...range },
          ids,
          policy
            ? { ...policy, isEnabled: true }
            : { ...DEFAULT_POLICY, isEnabled: true, version: 0 },
        );
        const { rows: names } = ids.length
          ? await sql<Row>`
          select e.id, e.employee_no, e.full_name_ar as employee_name,
                 (select d.name_ar from employments cur join departments d on d.id = cur.department_id
                   where cur.employee_id = e.id and cur.valid_from <= ${range.endDate}::date
                     and (cur.valid_to is null or cur.valid_to >= ${range.endDate}::date) limit 1) as department_name,
                 (select pl.status from payslips s join payroll_periods pl on pl.id = s.period_id
                   where s.employee_id = e.id and pl.year = ${q.year} and pl.month = ${q.month} limit 1) as payslip_status
            from employees e where e.id = any(${ids}::uuid[]) order by e.employee_no`.execute(
              ctx.trx,
            )
          : { rows: [] as Row[] };
        const all = names.flatMap((n) => {
          const ev = evals.get(n.id as string);
          return ev ? [{ ...n, ...ev }] : [];
        });
        const page = all.slice((q.page - 1) * q.pageSize, q.page * q.pageSize);
        return { rows: page, total: all.length, enabled: policy?.isEnabled ?? false };
      });
      res.json({
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total, policyEnabled: out.enabled },
      });
    }),
  );

  router.put(
    '/decisions',
    requirePermission(`${S}.decide`),
    wrap(async (req, res) => {
      const b = shortfallDecisionInput.parse(req.body);
      const auth = req.auth as AuthContext;
      await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, b.employeeId, `${S}.decide`);
        await assertMonthOpen(ctx, b.employeeId, b.year, b.month);
        if (b.target === 'leave' || b.target === 'split') {
          const policy = await loadPolicy(ctx);
          if (!policy?.leaveTypeId)
            throw new AppError(
              'NO_LEAVE_TYPE',
              409,
              'حدّد نوع الإجازة المخصوم منه في السياسة أولاً',
            );
        }
        await sql`
          insert into shortfall_decisions (company_id, employee_id, year, month, target, leave_days, reason, decided_by)
          values (${ctx.companyId}, ${b.employeeId}, ${b.year}, ${b.month}, ${b.target}, ${b.leaveDays ?? null},
                  ${b.reason}, ${ctx.userId})
          on conflict (company_id, employee_id, year, month) do update set
            target = excluded.target, leave_days = excluded.leave_days, reason = excluded.reason,
            decided_by = excluded.decided_by`.execute(ctx.trx);
        await recalcDrafts(ctx, b.employeeId, b.year, b.month);
      });
      res.json({ data: { ok: true } });
    }),
  );

  router.delete(
    '/decisions',
    requirePermission(`${S}.decide`),
    wrap(async (req, res) => {
      const b = z
        .object({
          employeeId: z.string().uuid(),
          year: z.coerce.number().int(),
          month: z.coerce.number().int().min(1).max(12),
        })
        .parse(req.query);
      const auth = req.auth as AuthContext;
      await run(req, async (ctx) => {
        await assertEmployeeVisible(ctx, auth, b.employeeId, `${S}.decide`);
        await assertMonthOpen(ctx, b.employeeId, b.year, b.month);
        await sql`delete from shortfall_decisions where company_id = ${ctx.companyId}
          and employee_id = ${b.employeeId} and year = ${b.year} and month = ${b.month}`.execute(
          ctx.trx,
        );
        await recalcDrafts(ctx, b.employeeId, b.year, b.month);
      });
      res.json({ data: { ok: true } });
    }),
  );

  return router;
};
