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
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const roleId: Record<string, string> = {};

  const seedUser = (email: string, role: string) =>
    withTenant(admin, { companyId: acme }, async (ctx) => {
      const u = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: u.id,
          roleId: roleId[role] as string,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
      return u.id;
    });
  const login = async (email: string, password = PASSWORD) =>
    (await request(api).post('/api/v1/auth/login').send({ identifier: email, password })).body.data
      ?.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));
  const patch = (who: string, path: string, body: object) =>
    request(api).patch(`/api/v1${path}`).set(as(who)).send(body);
  const put = (who: string, path: string, body: unknown) =>
    request(api)
      .put(`/api/v1${path}`)
      .set(as(who))
      .send(body as object);

  let adminId: string;

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
    for (const r of await admin
      .selectFrom('roles')
      .select(['id', 'code'])
      .where('companyId', '=', acme)
      .execute())
      roleId[r.code] = r.id;
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });
    adminId = await seedUser('admin@acme.test', 'admin');
    await seedUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('المستخدمون', () => {
    let newId: string;
    let newVersion: number;

    it('الموظف العادي لا يصل (403)', async () => {
      expect((await get('emp', '/users')).status).toBe(403);
      expect((await get('emp', '/roles')).status).toBe(403);
      expect((await get('emp', '/permissions')).status).toBe(403);
    });

    it('إنشاء: كلمة مرور ضعيفة 400، وصحيحة 201 مع إجبار التغيير', async () => {
      const weak = await post('admin', '/users', {
        email: 'new@acme.test',
        displayName: 'جديد',
        password: 'password123',
      });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      const ok = await post('admin', '/users', {
        email: 'New@Acme.test',
        username: 'newbie',
        displayName: 'جديد',
        password: 'a-long-initial-passphrase',
        roles: [{ roleId: roleId['employee'], scopeType: 'company' }],
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.email).toBe('new@acme.test');
      expect(ok.body.data.mustChangePassword).toBe(true);
      expect(ok.body.data).not.toHaveProperty('passwordHash');
      expect(ok.body.data.roles).toHaveLength(1);
      newId = ok.body.data.id;
      newVersion = ok.body.data.version;
      const dup = await post('admin', '/users', {
        email: 'new@acme.test',
        displayName: 'x',
        password: 'another-long-passphrase',
      });
      expect(dup.status).toBe(409);
    });

    it('المستخدم الجديد يدخل بالاسم ويُفرض عليه تغيير كلمة المرور', async () => {
      const res = await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: 'newbie', password: 'a-long-initial-passphrase' });
      expect(res.status).toBe(200);
      expect(res.body.data.mustChangePassword).toBe(true);
    });

    it('القائمة والبحث', async () => {
      const res = await get('admin', '/users?q=newbie');
      expect(res.body.meta.total).toBe(1);
      expect(res.body.data[0].id).toBe(newId);
    });

    it('القفل المتفائل على التعديل', async () => {
      const ok = await patch('admin', `/users/${newId}`, {
        displayName: 'اسم جديد',
        version: newVersion,
      });
      expect(ok.status).toBe(200);
      const stale = await patch('admin', `/users/${newId}`, {
        displayName: 'x',
        version: newVersion,
      });
      expect(stale.status).toBe(409);
      newVersion = ok.body.data.version;
    });

    it('التعطيل يمنع الدخول والطلبات فوراً، ولا تعطّل نفسك', async () => {
      tokens['newbie'] = await login('new@acme.test', 'a-long-initial-passphrase');
      expect((await get('newbie', '/auth/me')).status).toBe(200);
      const off = await patch('admin', `/users/${newId}`, {
        status: 'disabled',
        version: newVersion,
      });
      expect(off.status).toBe(200);
      expect((await get('newbie', '/auth/me')).status).toBe(401);
      expect(await login('new@acme.test', 'a-long-initial-passphrase')).toBeUndefined();
      const self = await patch('admin', `/users/${adminId}`, { status: 'disabled', version: 1 });
      expect(self.status).toBe(409);
      expect(self.body.error.code).toBe('SELF_DISABLE');
    });

    it('إعادة تعيين كلمة المرور تفتح القفل وتفرض التغيير', async () => {
      await patch('admin', `/users/${newId}`, { status: 'active', version: newVersion + 1 });
      const bad = await post('admin', `/users/${newId}/reset-password`, {
        password: 'password123',
      });
      expect(bad.status).toBe(400);
      const ok = await post('admin', `/users/${newId}/reset-password`, {
        password: 'brand-new-reset-passphrase',
      });
      expect(ok.status).toBe(204);
      const res = await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: 'new@acme.test', password: 'brand-new-reset-passphrase' });
      expect(res.status).toBe(200);
      expect(res.body.data.mustChangePassword).toBe(true);
    });

    it('إسناد الأدوار: استبدال كامل، ونطاق غير موجود 400', async () => {
      const bad = await put('admin', `/users/${newId}/role-assignments`, [
        {
          roleId: roleId['manager'],
          scopeType: 'branch',
          scopeId: '0197a000-0000-7000-8000-000000000000',
        },
      ]);
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('INVALID_REFERENCE');
      const ok = await put('admin', `/users/${newId}/role-assignments`, [
        { roleId: roleId['manager'], scopeType: 'company' },
        { roleId: roleId['employee'], scopeType: 'self' },
      ]);
      expect(ok.status).toBe(200);
      expect(ok.body.data).toHaveLength(2);
      const missingScope = await put('admin', `/users/${newId}/role-assignments`, [
        { roleId: roleId['manager'], scopeType: 'branch' },
      ]);
      expect(missingScope.status).toBe(400);
    });

    it('لا يمكن إزالة آخر مدير نظام', async () => {
      const res = await put('admin', `/users/${adminId}/role-assignments`, []);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('LAST_ADMIN');
      const still = await get('admin', `/users/${adminId}`);
      expect(still.body.data.roles).toHaveLength(1);
    });
  });

  describe('الأدوار', () => {
    let custom: { id: string; version: number };

    it('كتالوج الصلاحيات وقائمة الأدوار بعدّادات', async () => {
      const cat = await get('admin', '/permissions');
      expect(cat.body.data.length).toBeGreaterThan(30);
      const roles = await get('admin', '/roles');
      const adminRole = roles.body.data.find((r: { code: string }) => r.code === 'admin');
      expect(adminRole.permissionCount).toBe(cat.body.data.length);
      expect(adminRole.userCount).toBe(1);
    });

    it('إنشاء دور بصلاحيات، ورفض صلاحية غير معروفة', async () => {
      const bad = await post('admin', '/roles', {
        code: 'auditor',
        nameAr: 'مدقق',
        permissions: ['nope.nope.nope'],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.error.code).toBe('UNKNOWN_PERMISSION');
      const ok = await post('admin', '/roles', {
        code: 'auditor',
        nameAr: 'مدقق',
        permissions: ['system.audit.read'],
      });
      expect(ok.status).toBe(201);
      expect(ok.body.data.permissions).toEqual(['system.audit.read']);
      expect(ok.body.data.isSystem).toBe(false);
      custom = { id: ok.body.data.id, version: ok.body.data.version };
      expect(
        (await post('admin', '/roles', { code: 'auditor', nameAr: 'مكرر', permissions: [] }))
          .status,
      ).toBe(409);
    });

    it('تعديل صلاحيات دور ينعكس فوراً على مستخدميه (/me)', async () => {
      const uid = await seedUser('aud@acme.test', 'employee');
      await put('admin', `/users/${uid}/role-assignments`, [
        { roleId: custom.id, scopeType: 'company' },
      ]);
      tokens['aud'] = await login('aud@acme.test');
      expect((await get('aud', '/audit-logs')).status).toBe(200);
      expect((await get('aud', '/branches')).status).toBe(403);

      const upd = await patch('admin', `/roles/${custom.id}`, {
        permissions: ['system.branch.read'],
        version: custom.version,
      });
      expect(upd.status).toBe(200);
      expect((await get('aud', '/branches')).status).toBe(200);
      expect((await get('aud', '/audit-logs')).status).toBe(403);
      const me = await get('aud', '/auth/me');
      expect(me.body.data.permissions).toEqual(['system.branch.read']);

      const stale = await patch('admin', `/roles/${custom.id}`, {
        nameAr: 'x',
        version: custom.version,
      });
      expect(stale.status).toBe(409);
    });

    it('تغييرات الصلاحيات تُسجَّل في التدقيق', async () => {
      const res = await get(
        'admin',
        `/audit-logs?entityType=role_permissions&entityId=${custom.id}`,
      );
      expect(res.body.data.length).toBe(2);
      const last = res.body.data[0];
      expect(last.changes.added).toEqual(['system.branch.read']);
      expect(last.changes.removed).toEqual(['system.audit.read']);
    });

    it('دور admin ثابت، ولا يُحذف نظامي ولا مستخدم', async () => {
      const p = await patch('admin', `/roles/${roleId['admin']}`, { permissions: [], version: 1 });
      expect(p.status).toBe(409);
      expect(
        (await request(api).delete(`/api/v1/roles/${roleId['employee']}`).set(as('admin'))).status,
      ).toBe(409);
      const used = await request(api).delete(`/api/v1/roles/${custom.id}`).set(as('admin'));
      expect(used.status).toBe(409);
      expect(used.body.error.code).toBe('IN_USE');
    });
  });
});
