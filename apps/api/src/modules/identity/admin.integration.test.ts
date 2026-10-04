import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'w'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('إدارة المستخدمين والأدوار', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const makeUser = (companyId: string, email: string, roleCode: string) =>
    withTenant(admin, { companyId }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', companyId)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId,
          userId: user.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
      return user.id;
    });
  const login = async (email: string, password = PASSWORD) => {
    const r = await request(api).post('/api/v1/auth/login').send({ identifier: email, password });
    return r.body.data?.accessToken as string;
  };
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const call = (
    m: 'get' | 'post' | 'patch' | 'put' | 'delete',
    who: string,
    path: string,
    body?: object,
  ) => request(api)[m](`/api/v1${path}`).set(as(who)).send(body);

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'acme' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: acme }, (ctx) => seedDefaultRoles(ctx));
    api = createApp({
      logger: pino({ level: process.env['TEST_LOG'] ?? 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });
    ids['admin'] = await makeUser(acme, 'admin@acme.test', 'admin');
    ids['hr'] = await makeUser(acme, 'hr@acme.test', 'hr_manager');
    ids['emp'] = await makeUser(acme, 'emp@acme.test', 'employee');
    for (const [k, e] of [
      ['admin', 'admin@acme.test'],
      ['hr', 'hr@acme.test'],
      ['emp', 'emp@acme.test'],
    ] as const)
      tokens[k] = await login(e);
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('المستخدمون', () => {
    let newId: string;
    it('إنشاء مستخدم بدور، ثم دخوله، والاستجابة بلا كلمة المرور', async () => {
      const roles = (await call('get', 'admin', '/roles')).body.data as {
        id: string;
        code: string;
      }[];
      const employee = roles.find((r) => r.code === 'employee')!;
      const res = await call('post', 'admin', '/users', {
        email: 'New.User@Acme.test',
        displayName: 'مستخدم جديد',
        password: 'a-long-passphrase-1',
        assignments: [{ roleId: employee.id, scopeType: 'company' }],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.email).toBe('new.user@acme.test');
      expect(res.body.data.mustChangePassword).toBe(true);
      expect(JSON.stringify(res.body)).not.toMatch(/passwordHash|totpSecret/);
      expect(res.body.data.assignments).toHaveLength(1);
      newId = res.body.data.id;
      expect(await login('new.user@acme.test', 'a-long-passphrase-1')).toBeTruthy();
    });

    it('بريد مكرر 409، كلمة مرور ضعيفة 400', async () => {
      expect(
        (
          await call('post', 'admin', '/users', {
            email: 'admin@acme.test',
            displayName: 'x',
            password: 'a-long-passphrase-1',
          })
        ).status,
      ).toBe(409);
      const weak = await call('post', 'admin', '/users', {
        email: 'w@acme.test',
        displayName: 'x',
        password: 'password123',
      });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
    });

    it('قائمة بحث وترقيم', async () => {
      const res = await call('get', 'admin', '/users?q=new.user');
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].roles).toEqual(['موظف']);
    });

    it('الموظف العادي لا يصل (403)', async () => {
      expect((await call('get', 'emp', '/users')).status).toBe(403);
      expect((await call('get', 'emp', '/roles')).status).toBe(403);
    });

    it('تعطيل مستخدم يبطل جلساته فوراً، والقفل الذاتي مرفوض', async () => {
      const tok = await login('new.user@acme.test', 'a-long-passphrase-1');
      const dis = await call('patch', 'admin', `/users/${newId}`, {
        status: 'disabled',
        version: 1,
      });
      expect(dis.status).toBe(200);
      const me = await request(api)
        .get('/api/v1/auth/me')
        .set({ Authorization: `Bearer ${tok}` });
      expect(me.status).toBe(401);
      expect(
        (await login('new.user@acme.test', 'a-long-passphrase-1')) ?? undefined,
      ).toBeUndefined();
      const self = await call('patch', 'admin', `/users/${ids['admin']}`, {
        status: 'disabled',
        version: 1,
      });
      expect(self.body.error.code).toBe('SELF_LOCKOUT');
    });

    it('قفل متفائل على المستخدم', async () => {
      const stale = await call('patch', 'admin', `/users/${newId}`, {
        displayName: 'x',
        version: 1,
      });
      expect(stale.status).toBe(409);
    });

    it('إعادة تعيين كلمة المرور تفرض تغييرها وتبطل الجلسات', async () => {
      const r = await call('post', 'admin', `/users/${ids['emp']}/reset-password`, {
        password: 'temp-passphrase-99',
      });
      expect(r.status).toBe(204);
      const l = await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: 'emp@acme.test', password: 'temp-passphrase-99' });
      expect(l.status).toBe(200);
      expect(l.body.data.mustChangePassword).toBe(true);
      tokens['emp'] = l.body.data.accessToken;
    });

    it('مدير الموارد لا يمنح أدواراً (يحتاج identity.role.manage)', async () => {
      const r = await call('put', 'hr', `/users/${ids['emp']}/role-assignments`, {
        assignments: [],
      });
      expect(r.status).toBe(403);
    });

    it('الإسناد يرفع نسخة الصلاحيات ويسري فوراً، ولا يمكن إزالة إدارة الأدوار عن النفس', async () => {
      const roles = (await call('get', 'admin', '/roles')).body.data as {
        id: string;
        code: string;
      }[];
      const hrRole = roles.find((r) => r.code === 'hr_manager')!;
      const res = await call('put', 'admin', `/users/${ids['emp']}/role-assignments`, {
        assignments: [{ roleId: hrRole.id, scopeType: 'company' }],
      });
      expect(res.status).toBe(200);
      expect((await call('get', 'emp', '/users')).status).toBe(200);
      const adminRole = roles.find((r) => r.code === 'admin')!;
      expect(adminRole).toBeTruthy();
      const lock = await call('put', 'admin', `/users/${ids['admin']}/role-assignments`, {
        assignments: [{ roleId: hrRole.id, scopeType: 'company' }],
      });
      expect(lock.body.error.code).toBe('SELF_LOCKOUT');
    });
  });

  describe('الأدوار', () => {
    let roleId: string;
    it('كتالوج الصلاحيات متاح', async () => {
      const res = await call('get', 'admin', '/permissions');
      expect(res.body.data.length).toBeGreaterThan(30);
    });

    it('إنشاء دور مخصص بصلاحيات وتعديلها مع قفل متفائل', async () => {
      const c = await call('post', 'admin', '/roles', {
        code: 'auditor',
        nameAr: 'مدقق',
        permissions: ['system.audit.read', 'system.branch.read'],
      });
      expect(c.status).toBe(201);
      roleId = c.body.data.id;
      expect(c.body.data.permissions).toEqual(['system.audit.read', 'system.branch.read']);
      const u = await call('patch', 'admin', `/roles/${roleId}`, {
        permissions: ['system.audit.read'],
        version: 1,
      });
      expect(u.body.data.permissions).toEqual(['system.audit.read']);
      expect(u.body.data.version).toBe(2);
      expect(
        (await call('patch', 'admin', `/roles/${roleId}`, { nameAr: 'x', version: 1 })).status,
      ).toBe(409);
    });

    it('صلاحية غير معروفة 400، ودور admin مقفل، والدور النظامي لا يُحذف', async () => {
      expect(
        (
          await call('post', 'admin', '/roles', {
            code: 'bad',
            nameAr: 'x',
            permissions: ['no.such.perm'],
          })
        ).body.error.code,
      ).toBe('UNKNOWN_PERMISSION');
      const roles = (await call('get', 'admin', '/roles')).body.data as {
        id: string;
        code: string;
        version: number;
      }[];
      const adminRole = roles.find((r) => r.code === 'admin')!;
      const lock = await call('patch', 'admin', `/roles/${adminRole.id}`, {
        permissions: [],
        version: adminRole.version,
      });
      expect(lock.body.error.code).toBe('SYSTEM_ROLE_LOCKED');
      expect((await call('delete', 'admin', `/roles/${adminRole.id}`)).status).toBe(400);
    });

    it('منع تصعيد الصلاحيات: مدير موارد (بدون manage) لا يملك الوصول أصلاً، وغير المالك لا يمنح ما لا يملك', async () => {
      // نمنح hr صلاحية إدارة الأدوار فقط دون audit.read ثم يحاول منح audit.read
      const mk = await call('post', 'admin', '/roles', {
        code: 'role_mgr',
        nameAr: 'مدير أدوار',
        permissions: ['identity.role.manage', 'identity.role.read'],
      });
      const uid = await makeUser(acme, 'rm@acme.test', 'employee');
      await call('put', 'admin', `/users/${uid}/role-assignments`, {
        assignments: [{ roleId: mk.body.data.id, scopeType: 'company' }],
      });
      tokens['rm'] = await login('rm@acme.test');
      const plain = await call('post', 'admin', '/roles', {
        code: 'plain',
        nameAr: 'عادي',
        permissions: [],
      });
      const esc = await call('patch', 'rm', `/roles/${plain.body.data.id}`, {
        permissions: ['system.audit.read'],
        version: 1,
      });
      expect(esc.status).toBe(403);
      expect(esc.body.error.code).toBe('PRIVILEGE_ESCALATION');
    });

    it('حذف دور مسند مرفوض 409، وغير المسند يُحذف', async () => {
      const roles = (await call('get', 'admin', '/roles')).body.data as {
        id: string;
        code: string;
      }[];
      const mgr = roles.find((r) => r.code === 'role_mgr')!;
      expect((await call('delete', 'admin', `/roles/${mgr.id}`)).status).toBe(409);
      expect((await call('delete', 'admin', `/roles/${roleId}`)).status).toBe(204);
    });

    it('تغيير صلاحيات الدور مسجّل في التدقيق', async () => {
      const res = await call(
        'get',
        'admin',
        `/audit-logs?entityType=role_permissions&entityId=${roleId}`,
      );
      expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    });
  });
});
