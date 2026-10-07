import { sql, type RawBuilder } from 'kysely';
import type { OwnerType } from '@hrms/shared';
import type { Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { allowedBranchIds, type AuthContext } from '../identity/index.js';
import { employeeScope, assertEmployeeVisible } from '../employees/index.js';

const ZERO = '00000000-0000-0000-0000-000000000000';

/**
 * شرط رؤية الوثائق (مكتوباً على جدول documents بلا اسم مستعار) حسب نطاق المستخدم:
 * - وثائق الموظفين: نطاق الموظف نفسه (ذات/فريق/قسم/فرع/شركة).
 * - وثائق الفروع: الفروع المسندة.
 * - وثائق الشركة: نطاق الشركة فقط.
 */
export const documentScope = (auth: AuthContext, code: string): RawBuilder<boolean> => {
  const emp = employeeScope(auth, code);
  const branches = allowedBranchIds(auth, code);
  const parts: RawBuilder<boolean>[] = [
    emp === null
      ? sql<boolean>`documents.owner_type = 'employee'`
      : sql<boolean>`(documents.owner_type = 'employee'
          and exists (select 1 from employees where employees.id = documents.owner_id and ${emp}))`,
    branches === 'all'
      ? sql<boolean>`documents.owner_type = 'branch'`
      : sql<boolean>`(documents.owner_type = 'branch'
          and documents.owner_id in (${sql.join(branches.length ? branches : [ZERO])}))`,
  ];
  if (branches === 'all') parts.push(sql<boolean>`documents.owner_type = 'company'`);
  return sql<boolean>`(${sql.join(parts, sql` or `)})`;
};

/** يتأكد أن المالك موجود ومسموح للمستخدم (وإلا 404/400) ويعيد معرّف المالك الفعلي. */
export const resolveOwner = async (
  ctx: Ctx,
  auth: AuthContext,
  ownerType: OwnerType,
  ownerId: string | null | undefined,
  code: string,
): Promise<string> => {
  if (ownerType === 'company') {
    if (allowedBranchIds(auth, code) !== 'all')
      throw new AppError('NOT_FOUND', 404, 'المالك غير موجود');
    return ctx.companyId;
  }
  if (!ownerId) throw new AppError('VALIDATION_ERROR', 400, 'ownerId مطلوب لهذا النوع');
  if (ownerType === 'employee') {
    await assertEmployeeVisible(ctx, auth, ownerId, code);
    return ownerId;
  }
  const scope = allowedBranchIds(auth, code);
  const found =
    (scope === 'all' || scope.includes(ownerId)) &&
    (await ctx.trx
      .selectFrom('branches')
      .select('id')
      .where('id', '=', ownerId)
      .where('companyId', '=', ctx.companyId)
      .executeTakeFirst());
  if (!found) throw new AppError('NOT_FOUND', 404, 'المالك غير موجود');
  return ownerId;
};
