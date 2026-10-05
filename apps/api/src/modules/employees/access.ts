import { sql, type RawBuilder } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../identity/index.js';

/** التعيين الحالي للموظف (بتاريخ اليوم بتوقيت الشركة) كشرط SQL على employments مرتبط بـ employees. */
const currentEmploymentExists = (extra: RawBuilder<boolean>): RawBuilder<boolean> =>
  sql<boolean>`exists (
    select 1 from employments cur
     where cur.employee_id = employees.id
       and cur.valid_from <= company_today(employees.company_id)
       and (cur.valid_to is null or cur.valid_to >= company_today(employees.company_id))
       and ${extra})`;

/**
 * شرط رؤية الموظفين حسب نطاق صلاحية المستخدم، مكتوباً على جدول employees (بلا اسم مستعار).
 * - null = بلا قيد (نطاق الشركة).
 * - الذات: سجل الموظف المرتبط بحساب المستخدم.
 * - فرع/قسم: التعيين الحالي ضمن الفروع/الأقسام المسندة.
 * - فريق: الموظفون الذين مديرهم المباشر (في تعيينهم الحالي) هو موظف هذا المستخدم.
 */
export const employeeScope = (auth: AuthContext, code: string): RawBuilder<boolean> | null => {
  const grants = auth.grants.filter((g) => g.code === code);
  if (grants.some((g) => g.scopeType === 'company')) return null;
  const parts: RawBuilder<boolean>[] = [];
  const ids = (type: 'branch' | 'department') =>
    grants.flatMap((g) => (g.scopeType === type && g.scopeId ? [g.scopeId] : []));
  if (grants.some((g) => g.scopeType === 'self'))
    parts.push(sql<boolean>`employees.user_id = ${auth.userId}`);
  const branches = ids('branch');
  if (branches.length)
    parts.push(currentEmploymentExists(sql<boolean>`cur.branch_id in (${sql.join(branches)})`));
  const departments = ids('department');
  if (departments.length)
    parts.push(
      currentEmploymentExists(sql<boolean>`cur.department_id in (${sql.join(departments)})`),
    );
  if (grants.some((g) => g.scopeType === 'team'))
    parts.push(
      currentEmploymentExists(
        sql<boolean>`cur.manager_employee_id in (select id from employees me where me.user_id = ${auth.userId})`,
      ),
    );
  return parts.length ? sql<boolean>`(${sql.join(parts, sql` or `)})` : sql<boolean>`false`;
};

const notFound = () => new AppError('NOT_FOUND', 404, 'الموظف غير موجود');

/** يتأكد أن الموظف مرئي ضمن نطاق المستخدم، وإلا 404 (لا يكشف وجوده). */
export const assertEmployeeVisible = async (
  ctx: Ctx,
  auth: AuthContext,
  employeeId: string,
  code: string,
): Promise<void> => {
  const scope = employeeScope(auth, code);
  let q = ctx.trx.selectFrom('employees').select('id').where('id', '=', employeeId);
  if (scope) q = q.where(scope);
  if (!(await q.executeTakeFirst())) throw notFound();
};
