import { Router, type RequestHandler, type Request } from 'express';
import { sql } from 'kysely';
import {
  assignmentsInput,
  listQuery,
  resetPasswordInput,
  roleCreateInput,
  roleUpdateInput,
  userCreateInput,
  userUpdateInput,
  type ApiEnvelope,
} from '@hrms/shared';
import type { Db } from '../../db/index.js';
import { withTenant, type Ctx } from '../../db/tenant.js';
import { AppError } from '../../shared/errors.js';
import { checkPasswordPolicy, hashPassword } from './password.js';
import { invalidateSnapshot, loadGrants } from './permissions.service.js';
import { requirePermission, type AuthContext } from './middleware.js';

type Assignment = {
  roleId: string;
  scopeType: 'company' | 'branch' | 'department' | 'team' | 'self';
  scopeId?: string | null;
};

const notFound = () => new AppError('NOT_FOUND', 404, 'السجل غير موجود');
const idOf = (v: unknown): string => {
  if (typeof v !== 'string' || !/^[0-9a-f-]{36}$/i.test(v)) throw notFound();
  return v;
};
const conflict = () =>
  new AppError('VERSION_CONFLICT', 409, 'تم تعديل السجل من مستخدم آخر، أعد التحميل');
const like = (q: string) => `%${q.replace(/[%_\\]/g, '\\$&')}%`;

const auditEvent = (
  ctx: Ctx,
  entityType: string,
  entityId: string,
  action: string,
  changes: unknown,
) =>
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

const loadAssignments = (ctx: Ctx, userIds: string[]) =>
  userIds.length === 0
    ? Promise.resolve([])
    : ctx.trx
        .selectFrom('userRoleAssignments as a')
        .innerJoin('roles as r', 'r.id', 'a.roleId')
        .select([
          'a.id',
          'a.userId',
          'a.roleId',
          'r.code as roleCode',
          'r.nameAr as roleNameAr',
          'a.scopeType',
          'a.scopeId',
        ])
        .where('a.userId', 'in', userIds)
        .execute();

/** يتحقق أن الأدوار والنطاقات المشار إليها موجودة في الشركة (RLS يقيّد الاستعلام). */
const validateAssignments = async (ctx: Ctx, list: Assignment[]) => {
  const roleIds = [...new Set(list.map((a) => a.roleId))];
  if (roleIds.length) {
    const found = await ctx.trx
      .selectFrom('roles')
      .select('id')
      .where('id', 'in', roleIds)
      .execute();
    if (found.length !== roleIds.length)
      throw new AppError('INVALID_REFERENCE', 400, 'دور غير موجود');
  }
  for (const [type, table] of [
    ['branch', 'branches'],
    ['department', 'departments'],
  ] as const) {
    const ids = [
      ...new Set(
        list.filter((a) => a.scopeType === type && a.scopeId).map((a) => a.scopeId as string),
      ),
    ];
    if (!ids.length) continue;
    const found = await sql<{
      id: string;
    }>`select id from ${sql.table(table)} where id in (${sql.join(ids)})`.execute(ctx.trx);
    if (found.rows.length !== ids.length)
      throw new AppError('INVALID_REFERENCE', 400, 'نطاق غير موجود');
  }
};

const replaceAssignments = async (ctx: Ctx, userId: string, list: Assignment[]) => {
  await validateAssignments(ctx, list);
  const before = await loadAssignments(ctx, [userId]);
  await ctx.trx.deleteFrom('userRoleAssignments').where('userId', '=', userId).execute();
  if (list.length) {
    await ctx.trx
      .insertInto('userRoleAssignments')
      .values(
        list.map((a) => ({
          companyId: ctx.companyId,
          userId,
          roleId: a.roleId,
          scopeType: a.scopeType,
          scopeId: a.scopeId ?? null,
        })),
      )
      .execute();
  }
  await auditEvent(ctx, 'user_role_assignments', userId, 'replace', {
    before: before.map((b) => ({
      roleCode: b.roleCode,
      scopeType: b.scopeType,
      scopeId: b.scopeId,
    })),
    after: list,
  });
};

const hasCompanyAdmin = async (ctx: Ctx, userId: string): Promise<boolean> =>
  (await loadGrants(ctx, userId)).some(
    (g) => g.code === 'identity.role.manage' && g.scopeType === 'company',
  );

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
  const guard =
    (fn: (req: Request, res: import('express').Response) => Promise<void>): RequestHandler =>
    (req, res, next) => {
      fn(req, res).catch(next);
    };

  // ---------------- المستخدمون ----------------
  const publicUser = async (ctx: Ctx, id: string) => {
    const u = await ctx.trx
      .selectFrom('users')
      .select([
        'id',
        'email',
        'username',
        'displayName',
        'status',
        'mustChangePassword',
        'totpEnabled',
        'lastLoginAt',
        'passwordChangedAt',
        'version',
        'createdAt',
        'updatedAt',
      ])
      .where('id', '=', id)
      .executeTakeFirst();
    if (!u) throw notFound();
    return { ...u, assignments: await loadAssignments(ctx, [id]) };
  };

  router.get(
    '/users',
    requirePermission('identity.user.read'),
    guard(async (req, res) => {
      const q = listQuery.parse(req.query);
      const out = await run(req, async (ctx) => {
        const build = () => {
          let b = ctx.trx.selectFrom('users');
          if (q.q)
            b = b.where((eb) =>
              eb.or([
                eb('email', 'ilike', like(q.q as string)),
                eb('username', 'ilike', like(q.q as string)),
                eb('displayName', 'ilike', like(q.q as string)),
              ]),
            );
          if (q.isActive !== undefined)
            b = b.where('status', '=', q.isActive ? 'active' : 'disabled');
          return b;
        };
        const rows = await build()
          .select([
            'id',
            'email',
            'username',
            'displayName',
            'status',
            'mustChangePassword',
            'lastLoginAt',
            'version',
            'createdAt',
          ])
          .orderBy('displayName')
          .limit(q.pageSize)
          .offset((q.page - 1) * q.pageSize)
          .execute();
        const total = Number(
          (
            await build()
              .select(sql<string>`count(*)`.as('n'))
              .executeTakeFirstOrThrow()
          ).n,
        );
        const assigns = await loadAssignments(
          ctx,
          rows.map((r) => r.id),
        );
        return {
          rows: rows.map((r) => ({
            ...r,
            roles: [...new Set(assigns.filter((a) => a.userId === r.id).map((a) => a.roleNameAr))],
          })),
          total,
        };
      });
      const body: ApiEnvelope<typeof out.rows> = {
        data: out.rows,
        meta: { page: q.page, pageSize: q.pageSize, total: out.total },
      };
      res.json(body);
    }),
  );

  router.get(
    '/users/:id',
    requirePermission('identity.user.read'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      res.json({ data: await run(req, (ctx) => publicUser(ctx, id)) });
    }),
  );

  router.post(
    '/users',
    requirePermission('identity.user.create'),
    guard(async (req, res) => {
      const input = userCreateInput.parse(req.body);
      const problem = checkPasswordPolicy(input.password, input);
      if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
      const passwordHash = await hashPassword(input.password);
      const out = await run(req, async (ctx, auth) => {
        if (
          input.assignments.length &&
          !auth.grants.some((g) => g.code === 'identity.role.manage')
        ) {
          throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية إسناد الأدوار', {
            required: 'identity.role.manage',
          });
        }
        const u = await ctx.trx
          .insertInto('users')
          .values({
            companyId: ctx.companyId,
            email: input.email,
            username: input.username ?? null,
            displayName: input.displayName,
            passwordHash,
            mustChangePassword: input.mustChangePassword,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        if (input.assignments.length) await replaceAssignments(ctx, u.id, input.assignments);
        return publicUser(ctx, u.id);
      });
      res.status(201).json({ data: out });
    }),
  );

  router.patch(
    '/users/:id',
    requirePermission('identity.user.update'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      const { version, ...changes } = userUpdateInput.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        if (changes.status === 'disabled' && id === auth.userId) {
          throw new AppError('SELF_LOCKOUT', 400, 'لا يمكنك تعطيل حسابك بنفسك');
        }
        if (changes.status && !auth.grants.some((g) => g.code === 'identity.user.disable')) {
          throw new AppError('FORBIDDEN', 403, 'لا تملك صلاحية تعطيل/تفعيل المستخدمين', {
            required: 'identity.user.disable',
          });
        }
        const row = await ctx.trx
          .updateTable('users')
          .set({ ...changes, version: sql`version + 1` })
          .where('id', '=', id)
          .where('version', '=', version)
          .returning('id')
          .executeTakeFirst();
        if (!row) {
          const exists = await ctx.trx
            .selectFrom('users')
            .select('id')
            .where('id', '=', id)
            .executeTakeFirst();
          throw exists ? conflict() : notFound();
        }
        if (changes.status === 'disabled') {
          await ctx.trx
            .updateTable('refreshTokens')
            .set({ revokedAt: new Date() })
            .where('userId', '=', id)
            .where('revokedAt', 'is', null)
            .execute();
        }
        return publicUser(ctx, id);
      });
      invalidateSnapshot(id);
      res.json({ data: out });
    }),
  );

  router.post(
    '/users/:id/reset-password',
    requirePermission('identity.user.reset_password'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      const input = resetPasswordInput.parse(req.body);
      await run(req, async (ctx) => {
        const u = await ctx.trx
          .selectFrom('users')
          .select(['id', 'email', 'username'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!u) throw notFound();
        const problem = checkPasswordPolicy(input.password, u);
        if (problem) throw new AppError('WEAK_PASSWORD', 400, problem);
        await ctx.trx
          .updateTable('users')
          .set({
            passwordHash: await hashPassword(input.password),
            mustChangePassword: input.mustChangePassword,
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
        await auditEvent(ctx, 'users', id, 'password_reset', { by: ctx.userId });
      });
      res.status(204).end();
    }),
  );

  router.put(
    '/users/:id/role-assignments',
    requirePermission('identity.role.manage'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      const { assignments } = assignmentsInput.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        const exists = await ctx.trx
          .selectFrom('users')
          .select('id')
          .where('id', '=', id)
          .executeTakeFirst();
        if (!exists) throw notFound();
        const wasAdmin = id === auth.userId && (await hasCompanyAdmin(ctx, id));
        await replaceAssignments(ctx, id, assignments);
        if (wasAdmin && !(await hasCompanyAdmin(ctx, id))) {
          throw new AppError('SELF_LOCKOUT', 400, 'لا يمكنك إزالة صلاحية إدارة الأدوار عن نفسك');
        }
        return publicUser(ctx, id);
      });
      invalidateSnapshot(id);
      res.json({ data: out });
    }),
  );

  // ---------------- الأدوار والصلاحيات ----------------
  router.get(
    '/permissions',
    requirePermission('identity.role.read'),
    guard(async (req, res) => {
      const rows = await run(req, (ctx) =>
        ctx.trx
          .selectFrom('permissions')
          .select(['code', 'module', 'resource', 'action', 'descriptionAr'])
          .orderBy('module')
          .orderBy('resource')
          .orderBy('action')
          .execute(),
      );
      res.json({ data: rows });
    }),
  );

  const roleDetail = async (ctx: Ctx, id: string) => {
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
    return {
      id: role.id,
      code: role.code,
      nameAr: role.nameAr,
      nameEn: role.nameEn,
      isSystem: role.isSystem,
      version: role.version,
      permissions: perms.map((p) => p.code),
    };
  };

  /** يضبط صلاحيات الدور على القائمة المعطاة؛ يمنع منح ما لا يملكه المنفِّذ نفسه. */
  const setRolePermissions = async (
    ctx: Ctx,
    auth: AuthContext,
    roleId: string,
    codes: string[],
  ) => {
    const unique = [...new Set(codes)];
    const catalog = await ctx.trx.selectFrom('permissions').select(['id', 'code']).execute();
    const byCode = new Map(catalog.map((p) => [p.code, p.id]));
    const unknown = unique.filter((c) => !byCode.has(c));
    if (unknown.length)
      throw new AppError('UNKNOWN_PERMISSION', 400, 'صلاحيات غير معروفة', { unknown });
    const mine = new Set(auth.grants.map((g) => g.code));
    const current = await ctx.trx
      .selectFrom('rolePermissions as rp')
      .innerJoin('permissions as p', 'p.id', 'rp.permissionId')
      .select('p.code')
      .where('rp.roleId', '=', roleId)
      .execute();
    const have = new Set(current.map((c) => c.code));
    const added = unique.filter((c) => !have.has(c));
    const removed = [...have].filter((c) => !unique.includes(c));
    const escalation = added.filter((c) => !mine.has(c));
    if (escalation.length)
      throw new AppError('PRIVILEGE_ESCALATION', 403, 'لا يمكنك منح صلاحيات لا تملكها', {
        codes: escalation,
      });
    if (added.length) {
      await ctx.trx
        .insertInto('rolePermissions')
        .values(
          added.map((c) => ({
            roleId,
            permissionId: byCode.get(c) as string,
            companyId: ctx.companyId,
          })),
        )
        .execute();
    }
    if (removed.length) {
      await ctx.trx
        .deleteFrom('rolePermissions')
        .where('roleId', '=', roleId)
        .where(
          'permissionId',
          'in',
          removed.map((c) => byCode.get(c) as string),
        )
        .execute();
    }
    if (added.length || removed.length)
      await auditEvent(ctx, 'role_permissions', roleId, 'update', { added, removed });
    return added.length > 0 || removed.length > 0;
  };

  router.get(
    '/roles',
    requirePermission('identity.role.read'),
    guard(async (req, res) => {
      const rows = await run(req, async (ctx) => {
        const roles = await ctx.trx
          .selectFrom('roles')
          .select(['id', 'code', 'nameAr', 'nameEn', 'isSystem', 'version'])
          .orderBy('createdAt')
          .execute();
        const counts = await sql<{ roleId: string; permissions: number; users: number }>`
        select r.id as "roleId",
               (select count(*)::int from role_permissions where role_id = r.id) as permissions,
               (select count(distinct user_id)::int from user_role_assignments where role_id = r.id) as users
          from roles r`.execute(ctx.trx);
        return roles.map((r) => ({
          ...r,
          ...(counts.rows.find((c) => c.roleId === r.id) ?? { permissions: 0, users: 0 }),
        }));
      });
      res.json({ data: rows, meta: { total: rows.length } });
    }),
  );

  router.get(
    '/roles/:id',
    requirePermission('identity.role.read'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      res.json({ data: await run(req, (ctx) => roleDetail(ctx, id)) });
    }),
  );

  router.post(
    '/roles',
    requirePermission('identity.role.manage'),
    guard(async (req, res) => {
      const input = roleCreateInput.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        const r = await ctx.trx
          .insertInto('roles')
          .values({
            companyId: ctx.companyId,
            code: input.code,
            nameAr: input.nameAr,
            nameEn: input.nameEn ?? null,
          })
          .returning('id')
          .executeTakeFirstOrThrow();
        await setRolePermissions(ctx, auth, r.id, input.permissions);
        return roleDetail(ctx, r.id);
      });
      res.status(201).json({ data: out });
    }),
  );

  router.patch(
    '/roles/:id',
    requirePermission('identity.role.manage'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      const { version, permissions, ...names } = roleUpdateInput.parse(req.body);
      const out = await run(req, async (ctx, auth) => {
        const role = await ctx.trx
          .selectFrom('roles')
          .select(['id', 'code', 'version'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!role) throw notFound();
        if (role.version !== version) throw conflict();
        if (role.code === 'admin' && permissions) {
          throw new AppError(
            'SYSTEM_ROLE_LOCKED',
            400,
            'صلاحيات دور مدير النظام تُزامَن تلقائياً ولا تُعدَّل',
          );
        }
        const changed = permissions ? await setRolePermissions(ctx, auth, id, permissions) : false;
        if (Object.keys(names).length || changed) {
          await ctx.trx
            .updateTable('roles')
            .set({ ...names, version: sql`version + 1` })
            .where('id', '=', id)
            .execute();
        }
        return roleDetail(ctx, id);
      });
      res.json({ data: out });
    }),
  );

  router.delete(
    '/roles/:id',
    requirePermission('identity.role.manage'),
    guard(async (req, res) => {
      const id = idOf(req.params['id']);
      await run(req, async (ctx) => {
        const role = await ctx.trx
          .selectFrom('roles')
          .select(['id', 'isSystem'])
          .where('id', '=', id)
          .executeTakeFirst();
        if (!role) throw notFound();
        if (role.isSystem) throw new AppError('SYSTEM_ROLE_LOCKED', 400, 'لا يمكن حذف دور نظامي');
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
