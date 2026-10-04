import { sql } from 'kysely';
import type { Ctx, Trx } from '../../db/tenant.js';
import type { ScopeType } from '../../db/types.js';
import { DEFAULT_ROLES, PERMISSION_CATALOG } from './catalog.js';

export type Grant = { code: string; scopeType: ScopeType; scopeId: string | null };

/** يزامن كتالوج الصلاحيات (عام) من الكود إلى القاعدة؛ يُشغَّل بحساب المالك. */
export const syncPermissionCatalog = async (trx: Trx): Promise<void> => {
  await trx
    .insertInto('permissions')
    .values(PERMISSION_CATALOG.map((p) => ({ ...p })))
    .onConflict((oc) =>
      oc.column('code').doUpdateSet((eb) => ({
        module: eb.ref('excluded.module'),
        resource: eb.ref('excluded.resource'),
        action: eb.ref('excluded.action'),
        descriptionAr: eb.ref('excluded.descriptionAr'),
      })),
    )
    .execute();
};

/**
 * ينشئ الأدوار الافتراضية للشركة إن لم توجد، ويُعيد مزامنة دور admin دائماً (كل الصلاحيات).
 * بقية الأدوار تُبذر مرة واحدة ثم يعدّلها المستخدم.
 */
export const seedDefaultRoles = async (ctx: Ctx): Promise<void> => {
  const perms = await ctx.trx.selectFrom('permissions').select(['id', 'code']).execute();
  for (const role of DEFAULT_ROLES) {
    const existing = await ctx.trx
      .selectFrom('roles')
      .select('id')
      .where('code', '=', role.code)
      .executeTakeFirst();
    let roleId = existing?.id;
    const isNew = !roleId;
    if (!roleId) {
      const row = await ctx.trx
        .insertInto('roles')
        .values({
          companyId: ctx.companyId,
          code: role.code,
          nameAr: role.nameAr,
          nameEn: role.nameEn,
          isSystem: true,
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      roleId = row.id;
    }
    if (!isNew && role.grants !== '*') continue;
    const wanted = perms.filter((p) => role.grants === '*' || role.grants(p.code));
    if (wanted.length === 0) continue;
    await ctx.trx
      .insertInto('rolePermissions')
      .values(
        wanted.map((p) => ({
          roleId: roleId as string,
          permissionId: p.id,
          companyId: ctx.companyId,
        })),
      )
      .onConflict((oc) => oc.doNothing())
      .execute();
  }
};

/** الصلاحيات الفعلية للمستخدم: (رمز + نطاق) لكل إسناد دور. */
export const loadGrants = async (ctx: Ctx, userId: string): Promise<Grant[]> => {
  const { rows } = await sql<Grant>`
    select p.code, a.scope_type as "scopeType", a.scope_id as "scopeId"
      from user_role_assignments a
      join role_permissions rp on rp.role_id = a.role_id
      join permissions p on p.id = rp.permission_id
     where a.user_id = ${userId}`.execute(ctx.trx);
  return rows;
};

export type AuthSnapshot = { grants: Grant[]; permissionsVersion: number; active: boolean };
type CacheEntry = AuthSnapshot & { expires: number };
const CACHE_TTL_MS = 30_000;
const cache = new Map<string, CacheEntry>();

export const getCachedSnapshot = (userId: string): AuthSnapshot | null => {
  const hit = cache.get(userId);
  return hit && hit.expires >= Date.now() ? hit : null;
};

export const setCachedSnapshot = (userId: string, snapshot: AuthSnapshot): void => {
  cache.set(userId, { ...snapshot, expires: Date.now() + CACHE_TTL_MS });
};

export const invalidateSnapshot = (userId: string): void => {
  cache.delete(userId);
};

export const clearSnapshotCache = (): void => cache.clear();
