import type { Ctx } from '../../db/tenant.js';
import { seedDefaultExternalSystems } from '../employees/external.routes.js';
import { hashPassword, seedDefaultRoles } from '../identity/index.js';

/**
 * يجهّز شركة جديدة: الأدوار الافتراضية والأنظمة الخارجية ومستخدماً بدور admin.
 * يُستعمل من واجهة المنصة ومن أمر create-admin كي لا يختلف السلوك بينهما.
 * Provisions a new company: default roles, external systems and an admin user.
 * Shared by the platform API and the create-admin CLI so both behave identically.
 */
export const provisionCompanyAdmin = async (
  ctx: Ctx,
  admin: {
    email: string;
    username?: string | null;
    displayName: string;
    password: string;
    mustChangePassword?: boolean;
  },
): Promise<{ userId: string }> => {
  await seedDefaultRoles(ctx);
  await seedDefaultExternalSystems(ctx);
  const role = await ctx.trx
    .selectFrom('roles')
    .select('id')
    .where('companyId', '=', ctx.companyId)
    .where('code', '=', 'admin')
    .executeTakeFirstOrThrow();
  const user = await ctx.trx
    .insertInto('users')
    .values({
      companyId: ctx.companyId,
      email: admin.email,
      username: admin.username ?? null,
      displayName: admin.displayName,
      passwordHash: await hashPassword(admin.password),
      mustChangePassword: admin.mustChangePassword ?? false,
    })
    .returning('id')
    .executeTakeFirstOrThrow();
  await ctx.trx
    .insertInto('userRoleAssignments')
    .values({
      companyId: ctx.companyId,
      userId: user.id,
      roleId: role.id,
      scopeType: 'company',
      scopeId: null,
    })
    .execute();
  return { userId: user.id };
};
