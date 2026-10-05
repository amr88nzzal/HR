import { Router, type Request, type RequestHandler } from 'express';
import { sql } from 'kysely';
import { z } from 'zod';
import {
  roleAssignmentInput,
  roleInput,
  roleUpdateInput,
  userCreateInput,
  userListQuery,
  userUpdateInput,
  type ApiEnvelope,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { PERMISSION_CATALOG } from './catalog.js';
import { requirePermission, type AuthContext } from './middleware.js';
import { checkPasswordPolicy, hashPassword } from './password.js';
import { clearSnapshotCache } from './permissions.service.js';

type Assignment = z.infer<typeof roleAssignmentInput>;

const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};
const userView = (u: Record<string, unknown>) => ({
  id: u['id'],
  email: u['email'],
  username: u['username'],
  displayName: u['displayName'],
  status: u['status'],
  mustChangePassword: u['mustChangePassword'],
  lastLoginAt: u['lastLoginAt'],
  lockedUntil: u['lockedUntil'],
  totpEnabled: u['totpEnabled'],
  version: u['version'],
  createdAt: u['createdAt'],
});

const audit = (ctx: Ctx, entityType: string, entityId: string, action: string, changes: unknown) =>
  ctx.trx
    .insertInto('auditLogs')
    .values({
      companyId: ctx.companyId,
      userId: ctx.userId,
      entityType,
      entityId,
      action,
      changes: JSON.stringify(changes),
      requestId: ctx.requestId,
      ip: null,
    })
    .execute();

const assertScopesExist = async (ctx: Ctx, items: Assignment[]) => {
  for (const [table, type] of [
    ['branches', 'branch'],
    ['departments', 'department'],
  ] as const) {
    const ids = [
      ...new Set(items.filter((i) => i.scopeType === type).map((i) => i.scopeId as string)),
    ];
    if (!ids.length) continue;
    const found = await ctx.trx.selectFrom(table).select('id').where('id', 'in', ids).execute();
    if (found.length !== ids.length)
      throw new AppError('INVALID_REFERENCE', 400, 'نطاق غير موجود ضمن الشركة');
  }
  const roleIds = [...new Set(items.map((i) => i.roleId))];
  if (roleIds.length) {
    const found = await ctx.trx
      .selectFrom('roles')
      .select('id')
      .where('id', 'in', roleIds)
      .execute();
    if (found.length !== roleIds.length)
      throw new AppError('INVALID_REFERENCE', 400, 'دور غير موجود ضمن الشركة');
  }
};

/** يجب أن يبقى مستخدم نشط واحد على الأقل بدور admin بنطاق الشركة، حتى لا يُقفل النظام على أصحابه. */
const assertAdminRemains = async (ctx: Ctx) => {
  const { rows } = await sql<{ n: number }>`
    select count(*)::int as n
      from user_role_assignments a
      join roles r on r.id = a.role_id and r.code = 'admin'
      join users u on u.id = a.user_id and u.status = 'active'
     where a.scope_type = 'company'`.execute(ctx.trx);
  if ((rows[0]?.n ?? 0) < 1) {
    throw new AppError('LAST_ADMIN', 409, 'يجب أن يبقى مدير نظام نشط واحد على الأقل');
  }
};

const replaceAssignments = async (ctx: Ctx, userId: string, items: Assignment[]) => {
  await assertScopesExist(ctx, items);
  const before = await ctx.trx
    .selectFrom('userRoleAssignments')
    .select(['roleId', 'scopeType', 'scopeId'])
    .where('userId', '=', userId)
    .execute();
  await ctx.trx.deleteFrom('userRoleAssignments').where('userId', '=', userId).execute();
  const unique = new Map(items.map((i) => [`${i.roleId}|${i.scopeType}|${i.scopeId ?? ''}`, i]));
  if (unique.size) {
    await ctx.trx
      .insertInto('userRoleAssignments')
      .values(
        [...unique.values()].map((i) => ({
          companyId: ctx.companyId,
          userId,
          roleId: i.roleId,
          scopeType: i.scopeType,
          scopeId: i.scopeId ?? null,
        })),
      )
      .execute();
  }
  await assertAdminRemains(ctx);
  await audit(ctx, 'user_role_assignments', userId, 'replace', {
    before,
    after: [...unique.values()],
  });
};

const loadAssignments = (ctx: Ctx, userId: string) =>
  ctx.trx
    .selectFrom('userRoleAssignments as a')
    .innerJoin('roles as r', 'r.id', 'a.roleId')
    .select([
      'a.id',
      'a.roleId',
      'r.code as roleCode',
      'r.nameAr as roleNameAr',
      'a.scopeType',
      'a.scopeId',
    ])
    .where('a.userId', '=', userId)
    .orderBy('r.code')
    .execute();

const resolvePermissionIds = async (ctx: Ctx, codes: string[]): Promise<string[]> => {
  const unique = [...new Set(codes)];
  if (!unique.length) return [];
  const rows = await ctx.trx
    .selectFrom('permissions')
    .select(['id', 'code'])
    .where('code', 'in', unique)
    .execute();
  if (rows.length !== unique.length) {
    const known = new Set(rows.map((r) => r.code));
    throw new AppError('UNKNOWN_PERMISSION', 400, 'صلاحية غير معروفة', {
      unknown: unique.filter((c) => !known.has(c)),
    });
  }
  return rows.map((r) => r.id);
};

const setRolePermissions = async (ctx: Ctx, roleId: string, codes: string[]) => {
  const ids = await resolvePermissionIds(ctx, codes);
  const before = await ctx.trx
    .selectFrom('rolePermissions as rp')
    .innerJoin('permissions as p', 'p.id', 'rp.permissionId')
    .select('p.code')
    .where('rp.roleId', '=', roleId)
    .execute();
  await ctx.trx.deleteFrom('rolePermissions').where('roleId', '=', roleId).execute();
  if (ids.length) {
    await ctx.trx
      .insertInto('rolePermissions')
      .values(ids.map((permissionId) => ({ roleId, permissionId, companyId: ctx.companyId })))
      .execute();
  }
  const prev = new Set(before.map((b) => b.code));
  const next = new Set(codes);
  await audit(ctx, 'role_permissions', roleId, 'replace', {
    added: [...next].filter((c) => !prev.has(c)),
    removed: [...prev].filter((c) => !next.has(c)),
  });
};

export const createIdentityAdminRouter = (db: Db, authenticate: RequestHandler): Router => {
  const router = Router();
  router.use(authenticate);

  const run = <T>(req: Request, fn: (ctx: Ctx, auth: AuthContext) => Promise<T>): Promise<T> => {
    const auth = req.auth;
    if (!auth) throw new AppError('UNAUTHORIZED', 401, 'يلزم تسجيل الدخول');
    return withTenant(
      db,
      { companyId: auth.companyId, userId: auth.userId, requestId: req.requestId },
      (ctx) => fn(ctx, auth),
    );
  };
  const wrap =
    (h: (req: Request, res: import('express').Response) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      h(req, res).catch(next);
    };

  // ---------- كتالوج الصلاحيات ----------
  router.get(
    '/permissions',
    requirePermission('identity.role.read'),
    wrap(async (_req, res) => {
      res.json({
        data: PERMISSION_CATALOG.map(({ code, module, resource, action, descriptionAr }) => ({
          code,
          module,
          resource,
          action,
          descriptionAr,
        })),
      });
    }),
  );

  // ---------- المستخدمون ----------
  router.get(
    '/users',
    requirePermission('identity.user.read'),
    wrap(async (req, res) => {
      const q = userListQuery.parse(req.query);
      const out = await run(req, async (ctx) => {
        const build = () => {
          let b = ctx.trx.selectFrom('users');
          if (q.status) b = b.where('status', '=', q.status);
          if (q.q) {
            const like = `%${q.q.replace(/[%_\\]/g, '\\$&')}%`;
            b = b.where((eb) =>
              eb.or([
                eb('email', 'ilike', like),
                eb('username', 'ilike', like),
                eb('displayName', 'ilike', like),
              ]),
            );
          }
          return b;
        };
        const rows = await build()
          .selectAll()
          .orderBy('displayName')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
        const total = Number(
          (
            await build()
              .select((eb) => eb.fn.countAll<string>().as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        return { rows: rows.map((r) => userView(r)), total };
      });
      const body: ApiEnvelope<unknown[]> = {
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      };
      res.json(body);
    }),
  );

  router.get(
    '/users/:id',
    requirePermission('identity.user.read'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      const data = await run(req, async (ctx) => {
        const u = await ctx.trx
          .selectFrom('users')
          .selectAll()
          .where('id', '=', id)
          .executeTakeFirst();
        if (!u) throw notFound();
        return { ...userView(u), roles: await loadAssignments(ctx, id) };
      });
      res.json({ data });
    }),
  );

  router.post(
    '/users',
    requirePermission('identity.user.create'),
    wrap(async (req, res) => {
      const input = userCreateInput.parse(req.body);
      const problem = checkPasswordPolicy(input.password, input);
      if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
      const passwordHash = await hashPassword(input.password);
      const data = await run(req, async (ctx) => {
        const row = await ctx.trx
          .insertInto('users')
          .values({
            companyId: ctx.companyId,
            email: input.email,
            username: input.username ?? null,
            displayName: input.displayName,
            passwordHash,
            mustChangePassword: true,
          })
          .returningAll()
          .executeTakeFirstOrThrow();
        if (input.roles.length) await replaceAssignments(ctx, row.id, input.roles);
        return { ...userView(row), roles: await loadAssignments(ctx, row.id) };
      });
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/users/:id',
    requirePermission('identity.user.update'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      const { version, ...changes } = userUpdateInput.parse(req.body);
      const data = await run(req, async (ctx, auth) => {
        if (changes.status === 'disabled' && id === auth.userId) {
          throw new AppError('SELF_DISABLE', 409, 'لا يمكنك تعطيل حسابك بنفسك');
        }
        const row = await ctx.trx
          .updateTable('users')
          .set({ ...changes, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returningAll()
          .executeTakeFirst();
        if (!row) {
          const exists = await ctx.trx
            .selectFrom('users')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
          if (!exists) throw notFound();
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
        }
        if (changes.status === 'disabled') {
          await ctx.trx
            .updateTable('refreshTokens')
            .set({ revokedAt: new Date() })
            .where('userId', '=', id)
            .where('revokedAt', 'is', null)
            .execute();
          await assertAdminRemains(ctx);
        }
        return { ...userView(row), roles: await loadAssignments(ctx, id) };
      });
      clearSnapshotCache(); // التعطيل ينفذ فوراً لا بعد 30 ثانية
      res.json({ data });
    }),
  );

  router.post(
    '/users/:id/reset-password',
    requirePermission('identity.user.reset_password'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      const { password } = z.object({ password: z.string().min(1).max(256) }).parse(req.body);
      await run(req, async (ctx) => {
        const u = await ctx.trx
          .selectFrom('users')
          .select(['email', 'username'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!u) throw notFound();
        const problem = checkPasswordPolicy(password, u);
        if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
        await ctx.trx
          .updateTable('users')
          .set({
            passwordHash: await hashPassword(password),
            mustChangePassword: true,
            failedAttempts: 0,
            lockedUntil: null,
            passwordChangedAt: new Date(),
          })
          .where('id', '=', id)
          .execute();
        await ctx.trx
          .updateTable('refreshTokens')
          .set({ revokedAt: new Date() })
          .where('userId', '=', id)
          .where('revokedAt', 'is', null)
          .execute();
        await audit(ctx, 'users', id, 'password_reset', {});
      });
      res.status(204).end();
    }),
  );

  router.put(
    '/users/:id/role-assignments',
    requirePermission('identity.user.update'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      const items = z.array(roleAssignmentInput).max(20).parse(req.body);
      const data = await run(req, async (ctx) => {
        const exists = await ctx.trx
          .selectFrom('users')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!exists) throw notFound();
        await replaceAssignments(ctx, id, items);
        return loadAssignments(ctx, id);
      });
      clearSnapshotCache();
      res.json({ data });
    }),
  );

  // ---------- الأدوار ----------
  const roleWithPerms = async (ctx: Ctx, id: string) => {
    const role = await ctx.trx
      .selectFrom('roles')
      .selectAll()
      .where('id', '=', id)
      .executeTakeFirst();
    if (!role) throw notFound();
    const perms = await ctx.trx
      .selectFrom('rolePermissions as rp')
      .innerJoin('permissions as p', 'p.id', 'rp.permissionId')
      .select('p.code')
      .where('rp.roleId', '=', id)
      .orderBy('p.code')
      .execute();
    const { companyId: _c, ...rest } = role;
    void _c;
    return { ...rest, permissions: perms.map((p) => p.code) };
  };

  router.get(
    '/roles',
    requirePermission('identity.role.read'),
    wrap(async (req, res) => {
      const data = await run(req, async (ctx) => {
        const { rows } = await sql<Record<string, unknown>>`
          select r.id, r.code, r.name_ar as "nameAr", r.name_en as "nameEn", r.is_system as "isSystem", r.version,
                 (select count(*)::int from role_permissions rp where rp.role_id = r.id) as "permissionCount",
                 (select count(distinct a.user_id)::int from user_role_assignments a where a.role_id = r.id) as "userCount"
            from roles r order by r.is_system desc, r.code`.execute(ctx.trx);
        return rows;
      });
      res.json({ data });
    }),
  );

  router.get(
    '/roles/:id',
    requirePermission('identity.role.read'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      res.json({ data: await run(req, (ctx) => roleWithPerms(ctx, id)) });
    }),
  );

  router.post(
    '/roles',
    requirePermission('identity.role.manage'),
    wrap(async (req, res) => {
      const input = roleInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const role = await ctx.trx
          .insertInto('roles')
          .values({
            companyId: ctx.companyId,
            code: input.code,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await setRolePermissions(ctx, role.id, input.permissions);
        return roleWithPerms(ctx, role.id);
      });
      clearSnapshotCache();
      res.status(201).json({ data });
    }),
  );

  router.patch(
    '/roles/:id',
    requirePermission('identity.role.manage'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      const { version, permissions, ...changes } = roleUpdateInput.parse(req.body);
      const data = await run(req, async (ctx) => {
        const current = await ctx.trx
          .selectFrom('roles')
          .select(['code'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!current) throw notFound();
        // دور admin يُزامَن آلياً بكل الصلاحيات ولا يُعدَّل
        if (current.code === 'admin' && permissions) {
          throw new AppError('SYSTEM_ROLE', 409, 'صلاحيات دور مدير النظام ثابتة');
        }
        const row = await ctx.trx
          .updateTable('roles')
          .set({ ...changes, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returning('id')
          .executeTakeFirst();
        if (!row)
          throw new AppError('VERSION_CONFLICT', 409, 'تم تعديل الدور من مستخدم آخر، أعد التحميل');
        if (permissions) await setRolePermissions(ctx, id, permissions);
        return roleWithPerms(ctx, id);
      });
      clearSnapshotCache();
      res.json({ data });
    }),
  );

  router.delete(
    '/roles/:id',
    requirePermission('identity.role.manage'),
    wrap(async (req, res) => {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const role = await ctx.trx
          .selectFrom('roles')
          .select(['isSystem'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!role) throw notFound();
        if (role.isSystem) throw new AppError('SYSTEM_ROLE', 409, 'لا يمكن حذف دور نظامي');
        const used = await ctx.trx
          .selectFrom('userRoleAssignments')
          .select('id')
          .where('roleId', '=', id)
          .limit(1)
          .executeTakeFirst();
        if (used) throw new AppError('IN_USE', 409, 'الدور مسند لمستخدمين، أزل الإسناد أولاً');
        await ctx.trx.deleteFrom('roles').where('id', '=', id).execute();
      });
      res.status(204).end();
    }),
  );

  return router;
};
