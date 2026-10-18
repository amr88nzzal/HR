import { sql, type RawBuilder } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import { loadCalendar } from './requests.js';

/** الفترة الحالية للتعيين (بتاريخ الشركة المحلي) لربط الموظف بالفرع والقسم والمدير. */
const currentEmployment = sql`left join employments cur on cur.employee_id = e.id
    and cur.valid_from <= company_today(e.company_id)
    and (cur.valid_to is null or cur.valid_to >= company_today(e.company_id))`;

const and = (parts: RawBuilder<unknown>[]): RawBuilder<unknown> =>
  parts.length ? sql.join(parts, sql` and `) : sql`true`;

export type CalendarQuery = {
  from: string;
  to: string;
  departmentId?: string[] | undefined;
  branchId?: string[] | undefined;
};

export type CalendarRequest = {
  id: string;
  employeeId: string;
  employeeName: string;
  leaveTypeId: string;
  typeNameAr: string;
  typeNameEn: string | null;
  color: string | null;
  startDate: string;
  endDate: string;
  status: 'pending' | 'approved';
  chargedDays: string;
  firstDayHalf: boolean;
  lastDayHalf: boolean;
};

/**
 * تقويم الإجازات (المعتمدة والمعلّقة) ضمن فترة.
 * النطاق: من يملك read_all يرى الجميع؛ غيره يرى نفسه ومرؤوسيه المباشرين فقط.
 */
export const calendarData = async (
  ctx: Ctx,
  q: CalendarQuery,
  scope: { all: boolean; employeeId: string | null },
) => {
  const where: RawBuilder<unknown>[] = [
    sql`r.company_id = ${ctx.companyId}`,
    sql`r.status in ('pending', 'approved')`,
    sql`r.start_date <= ${q.to}::date`,
    sql`r.end_date >= ${q.from}::date`,
  ];
  if (q.departmentId?.length) where.push(sql`cur.department_id = any(${q.departmentId}::uuid[])`);
  if (q.branchId?.length) where.push(sql`cur.branch_id = any(${q.branchId}::uuid[])`);
  if (!scope.all) {
    where.push(
      scope.employeeId
        ? sql`(e.id = ${scope.employeeId} or cur.manager_employee_id = ${scope.employeeId})`
        : sql`false`,
    );
  }
  const { rows: requests } = await sql<CalendarRequest>`
    select r.id, r.employee_id, e.full_name_ar as employee_name, r.leave_type_id,
           t.name_ar as type_name_ar, t.name_en as type_name_en, t.color,
           r.start_date::text as start_date, r.end_date::text as end_date, r.status,
           coalesce(r.override_days, r.days)::text as charged_days,
           r.first_day_half, r.last_day_half
      from leave_requests r
      join employees e on e.id = r.employee_id
      join leave_types t on t.id = r.leave_type_id
      ${currentEmployment}
     where ${and(where)}
     order by e.full_name_ar, r.start_date`.execute(ctx.trx);

  const holidays = await ctx.trx
    .selectFrom('holidays')
    .select(['holidayDate', 'nameAr', 'nameEn'])
    .where('companyId', '=', ctx.companyId)
    .where('holidayDate', '>=', q.from)
    .where('holidayDate', '<=', q.to)
    .orderBy('holidayDate')
    .execute();
  const cal = await loadCalendar(ctx, q.from, q.to);
  return { requests, holidays, weeklyOff: cal.weeklyOff };
};

export type ReportQuery = {
  leaveTypeId?: string[] | undefined;
  departmentId?: string[] | undefined;
  branchId?: string[] | undefined;
  q?: string | undefined;
  page: number;
  pageSize: number;
};

export type ReportRow = {
  employeeId: string;
  employeeNo: string;
  employeeName: string;
  departmentNameAr: string | null;
  departmentNameEn: string | null;
  leaveTypeId: string;
  balance: string;
  taken: string;
  pending: string;
};

/**
 * تقرير الأرصدة: صف لكل موظف (غير منتهي الخدمة) ونوع إجازة مدفوع فعّال.
 * المستهلك = المعتمد الذي يبدأ في السنة الحالية، والمعلّق = المحجوز بانتظار الموافقة.
 */
export const balanceReport = async (ctx: Ctx, q: ReportQuery) => {
  const where: RawBuilder<unknown>[] = [
    sql`e.company_id = ${ctx.companyId}`,
    sql`e.status <> 'terminated'`,
    sql`t.is_active and t.is_paid`,
  ];
  if (q.leaveTypeId?.length) where.push(sql`t.id = any(${q.leaveTypeId}::uuid[])`);
  if (q.departmentId?.length) where.push(sql`cur.department_id = any(${q.departmentId}::uuid[])`);
  if (q.branchId?.length) where.push(sql`cur.branch_id = any(${q.branchId}::uuid[])`);
  if (q.q) {
    const like = `%${q.q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    where.push(sql`(e.full_name_ar ilike ${like} or e.employee_no ilike ${like})`);
  }
  const from = sql`from employees e
      cross join leave_types t
      ${currentEmployment}
      left join departments d on d.id = cur.department_id
      left join leave_balances b
        on b.employee_id = e.id and b.leave_type_id = t.id and b.company_id = e.company_id
     where ${and(where)}`;
  const sum = (status: string) => sql`coalesce((
      select sum(coalesce(r.override_days, r.days)) from leave_requests r
       where r.employee_id = e.id and r.leave_type_id = t.id and r.status = ${status}
         and extract(year from r.start_date) = extract(year from company_today(e.company_id))
    ), 0)::text`;
  const { rows } = await sql<ReportRow>`
    select e.id as employee_id, e.employee_no, e.full_name_ar as employee_name,
           d.name_ar as department_name_ar, d.name_en as department_name_en,
           t.id as leave_type_id, coalesce(b.balance, 0)::text as balance,
           ${sum('approved')} as taken, ${sum('pending')} as pending
      ${from}
     order by e.employee_no, t.code
     limit ${q.pageSize} offset ${(q.page - 1) * q.pageSize}`.execute(ctx.trx);
  const { rows: c } = await sql<{ n: string }>`select count(*)::text as n ${from}`.execute(ctx.trx);
  return { rows, total: Number(c[0]?.n ?? 0) };
};
