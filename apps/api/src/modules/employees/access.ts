import { sql, type RawBuilder } from 'kysely';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import type { AuthContext } from '../identity/index.js';

/**
 * شرط رؤية الموظفين حسب نطاق صلاحية المستخدم، مكتوباً على جدول employees (بلا اسم مستعار).
 * - null = بلا قيد (نطاق الشركة).
 * - الذات: سجل الموظف المرتبط بحساب المستخدم.
 * - فرع/قسم/فريق: يعتمد على التعيين الحالي (employments) ويُضاف في 2b؛ حتى ذلك الحين لا يطابق شيئاً (الأمان أولاً).
 */
export const employeeScope = (auth: AuthContext, code: string): RawBuilder<boolean> | null => {
  const grants = auth.grants.filter((g) => g.code === code);
  if (grants.some((g) => g.scopeType === 'company')) return null;
  const parts: RawBuilder<boolean>[] = [];
  if (grants.some((g) => g.scopeType === 'self'))
    parts.push(sql<boolean>`employees.user_id = ${auth.userId}`);
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
