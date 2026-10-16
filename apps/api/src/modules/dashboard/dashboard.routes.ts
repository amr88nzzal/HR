import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import type { Db } from '../../db/index.js';
import type { Ctx } from '../../db/tenant.js';
import { employeeScope } from '../employees/index.js';
import { hasPermission, type AuthContext } from '../identity/index.js';
import { makeRun } from '../payroll/index.js';

type Row = Record<string, unknown>;
const n = (v: unknown): number => Number(v ?? 0);

/** قسم «أنا»: متاح لكل مستخدم، ويخص موظفه المرتبط فقط */
const mySection = async (ctx: Ctx, auth: AuthContext) => {
  const emp = await ctx.trx
    .selectFrom('employees')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('userId', '=', auth.userId)
    .executeTakeFirst();
  const pending = await sql<Row>`
    select count(*)::int as c from approval_request_assignees
     where user_id = ${auth.userId} and company_id = ${ctx.companyId} and status = 'pending'`.execute(
    ctx.trx,
  );
  if (!emp) return { employeeLinked: false, pendingApprovals: n(pending.rows[0]?.c) };
  const bal = await sql<Row>`
    select coalesce(sum(balance), 0)::text as total from leave_balances
     where employee_id = ${emp.id} and company_id = ${ctx.companyId}`.execute(ctx.trx);
  const slip = await sql<Row>`
    select s.id, p.year, p.month from payslips s join payroll_periods p on p.id = s.period_id
     where s.employee_id = ${emp.id} and s.company_id = ${ctx.companyId}
       and p.status = 'locked' and s.status = 'calculated'
     order by p.year desc, p.month desc limit 1`.execute(ctx.trx);
  const today = await sql<Row>`
    select coalesce(override_status, status) as status, first_in, last_out from attendance_days
     where employee_id = ${emp.id} and day_date = current_date`.execute(ctx.trx);
  const myLeave = await sql<Row>`
    select count(*)::int as c from leave_requests
     where employee_id = ${emp.id} and company_id = ${ctx.companyId} and status = 'pending'`.execute(
    ctx.trx,
  );
  return {
    employeeLinked: true,
    pendingApprovals: n(pending.rows[0]?.c),
    leaveBalance: bal.rows[0]?.total ?? '0',
    pendingLeaveRequests: n(myLeave.rows[0]?.c),
    latestPayslip: slip.rows[0] ?? null,
    today: today.rows[0] ?? null,
  };
};

/** يملك الصلاحية بنطاق أوسع من «نفسه» (فرع/قسم/شركة)؛ من نطاقه ذاته فقط لا تفيده أعداد الفريق */
const broad = (auth: AuthContext, code: string): boolean =>
  auth.grants.some((g) => g.code === code && g.scopeType !== 'self');

/** قسم المؤسسة/الفريق: الأعداد ضمن نطاق صلاحية المستخدم على الموظفين */
const orgSection = async (ctx: Ctx, auth: AuthContext) => {
  const scope = (code: string) => employeeScope(auth, code);
  const out: Record<string, unknown> = {};
  if (broad(auth, 'employees.employee.read')) {
    const s = scope('employees.employee.read');
    const r = await sql<Row>`
      select count(*) filter (where status = 'active')::int as active,
             count(*) filter (where status = 'suspended')::int as suspended,
             count(*) filter (where status = 'active' and first_hire_date >= current_date - 30)::int as new_hires
        from employees where company_id = ${ctx.companyId} ${s ? sql`and ${s}` : sql``}`.execute(
      ctx.trx,
    );
    out['headcount'] = r.rows[0];
  }
  if (broad(auth, 'leave.request.read_all')) {
    const s = scope('leave.request.read_all');
    const r = await sql<Row>`
      select count(*) filter (where lr.status = 'pending')::int as pending,
             count(*) filter (where lr.status = 'approved' and current_date between lr.start_date and lr.end_date)::int as on_leave_today
        from leave_requests lr join employees on employees.id = lr.employee_id
       where lr.company_id = ${ctx.companyId} ${s ? sql`and ${s}` : sql``}`.execute(ctx.trx);
    out['leave'] = r.rows[0];
  }
  if (broad(auth, 'attendance.day.read_all')) {
    const s = scope('attendance.day.read_all');
    const r = await sql<Row>`
      select count(*) filter (where coalesce(d.override_status, d.status) = 'present')::int as present,
             count(*) filter (where coalesce(d.override_status, d.status) = 'absent')::int as absent,
             count(*) filter (where d.late_minutes > 0)::int as late,
             count(*) filter (where d.diff_warning)::int as needs_review
        from attendance_days d join employees on employees.id = d.employee_id
       where d.company_id = ${ctx.companyId} and d.day_date = current_date ${s ? sql`and ${s}` : sql``}`.execute(
      ctx.trx,
    );
    out['attendance'] = r.rows[0];
  }
  return out;
};

/** قسم الرواتب: أحدث دورة وحالتها وإجمالياتها والتعديلات اليدوية والدفعات المعلّقة */
const payrollSection = async (ctx: Ctx, auth: AuthContext) => {
  const out: Record<string, unknown> = {};
  if (hasPermission(auth, 'payroll.period.read')) {
    const r = await sql<Row>`
      select p.id, p.year, p.month, p.status, p.currency,
             (select count(*)::int from payslips s where s.period_id = p.id) as employees_count,
             (select count(*)::int from payslips s where s.period_id = p.id and s.has_manual) as manual_count,
             (select count(*)::int from payslips s where s.period_id = p.id and s.status = 'error') as error_count,
             coalesce((select sum(s.net_amount) from payslips s where s.period_id = p.id), 0)::text as net_total,
             coalesce((select sum(s.payable_amount) from payslips s where s.period_id = p.id), 0)::text as payable_total
        from payroll_periods p where p.company_id = ${ctx.companyId}
       order by p.year desc, p.month desc, p.created_at desc limit 1`.execute(ctx.trx);
    out['latestPeriod'] = r.rows[0] ?? null;
  }
  if (hasPermission(auth, 'payroll.payment.read')) {
    const r = await sql<Row>`
      select count(*)::int as pending, coalesce(sum(amount), 0)::text as amount
        from payments where company_id = ${ctx.companyId} and status = 'pending'`.execute(ctx.trx);
    out['pendingPayments'] = r.rows[0];
  }
  if (hasPermission(auth, 'payroll.loan.read')) {
    const r = await sql<Row>`
      select count(*)::int as active from loans where company_id = ${ctx.companyId} and status = 'active'`.execute(
      ctx.trx,
    );
    out['activeLoans'] = r.rows[0];
  }
  return out;
};

/**
 * GET /dashboard/summary — أقسام تُحجب بالصلاحيات (القسم الغائب = لا يملكها).
 * لا مبالغ رواتب ولا أعداد تتجاوز نطاق المستخدم.
 */
export const createDashboardRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  const run = makeRun(db);
  router.use(authenticate);
  router.get('/summary', (req: Request, res, next) => {
    const auth = req.auth as AuthContext;
    run(req, async (ctx) => {
      const data: Record<string, unknown> = { me: await mySection(ctx, auth) };
      const org = await orgSection(ctx, auth);
      if (Object.keys(org).length) data['org'] = org;
      const payroll = await payrollSection(ctx, auth);
      if (Object.keys(payroll).length) data['payroll'] = payroll;
      return data;
    })
      .then((data) => res.json({ data }))
      .catch(next);
  });
  return router;
};
