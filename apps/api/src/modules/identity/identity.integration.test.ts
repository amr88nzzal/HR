import express from 'express';
import { sql } from 'kysely';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createErrorHandler } from '../../shared/errors.js';
import { requestIdMiddleware } from '../../shared/logging.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import {
  clearSnapshotCache,
  createAuthenticate,
  hashPassword,
  requirePermission,
  seedDefaultRoles,
  syncPermissionCatalog,
} from './index.js';

const logger = pino({ level: 'silent' });
const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'x'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('الهوية والمصادقة وRLS', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let globex: string;

  const makeUser = async (companyId: string, email: string, roleCode: string) =>
    withTenant(admin, { companyId, requestId: 't' }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
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

  const buildApp = () =>
    createApp({ logger, auth: { db: app, settings, cookieSecure: false, rateLimit: false } });

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    const mk = async (slug: string) => {
      const row = await admin
        .insertInto('companies')
        .values({ slug, nameAr: slug })
        .returning('id')
        .executeTakeFirstOrThrow();
      await withTenant(admin, { companyId: row.id }, (ctx) => seedDefaultRoles(ctx));
      return row.id;
    };
    acme = await mk('acme');
    globex = await mk('globex');
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(acme, 'emp@acme.test', 'employee');
    await makeUser(globex, 'admin@globex.test', 'admin');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  beforeEach(async () => {
    clearSnapshotCache();
    await admin.updateTable('users').set({ failedAttempts: 0, lockedUntil: null }).execute();
  });

  describe('RLS', () => {
    it('كل شركة ترى بياناتها فقط', async () => {
      const seen = await withTenant(app, { companyId: acme }, (ctx) =>
        ctx.trx.selectFrom('users').select('email').orderBy('email').execute(),
      );
      expect(seen.map((u) => u.email)).toEqual(['admin@acme.test', 'emp@acme.test']);
    });

    it('بلا سياق شركة لا تظهر أي صفوف', async () => {
      const { rows } = await sql<{ n: number }>`select count(*)::int as n from users`.execute(app);
      expect(rows[0]?.n).toBe(0);
    });

    it('لا يمكن إدخال صف لشركة أخرى', async () => {
      await expect(
        withTenant(app, { companyId: acme }, (ctx) =>
          ctx.trx
            .insertInto('roles')
            .values({ companyId: globex, code: 'evil', nameAr: 'x' })
            .execute(),
        ),
      ).rejects.toThrow(/row-level security/);
    });

    it('سجل التدقيق للإضافة فقط', async () => {
      await expect(
        withTenant(app, { companyId: acme }, (ctx) =>
          ctx.trx.updateTable('auditLogs').set({ action: 'x' }).execute(),
        ),
      ).rejects.toThrow(/permission denied/);
      await expect(
        withTenant(app, { companyId: acme }, (ctx) => ctx.trx.deleteFrom('auditLogs').execute()),
      ).rejects.toThrow(/permission denied/);
    });
  });

  describe('التدقيق والإصدارات', () => {
    it('تدقيق المستخدم لا يخزّن كلمة المرور', async () => {
      const rows = await admin
        .selectFrom('auditLogs')
        .select('changes')
        .where('entityType', '=', 'users')
        .where('companyId', '=', acme)
        .execute();
      expect(rows.length).toBeGreaterThanOrEqual(2);
      for (const r of rows) expect(JSON.stringify(r.changes)).not.toContain('password_hash');
    });

    it('إسناد دور يرفع permissions_version', async () => {
      const id = await makeUser(acme, 'pv@acme.test', 'employee');
      const before = await admin
        .selectFrom('users')
        .select('permissionsVersion')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      await withTenant(admin, { companyId: acme }, async (ctx) => {
        const role = await ctx.trx
          .selectFrom('roles')
          .select('id')
          .where('code', '=', 'manager')
          .executeTakeFirstOrThrow();
        await ctx.trx
          .insertInto('userRoleAssignments')
          .values({
            companyId: acme,
            userId: id,
            roleId: role.id,
            scopeType: 'company',
            scopeId: null,
          })
          .execute();
      });
      const after = await admin
        .selectFrom('users')
        .select('permissionsVersion')
        .where('id', '=', id)
        .executeTakeFirstOrThrow();
      expect(after.permissionsVersion).toBeGreaterThan(before.permissionsVersion);
    });
  });

  describe('الدخول والجلسات', () => {
    const login = (
      a: ReturnType<typeof buildApp>,
      identifier: string,
      password = PASSWORD,
      company?: string,
    ) => request(a).post('/api/v1/auth/login').send({ identifier, password, company });

    it('دخول ناجح يعطي access token وكوكي refresh، و/me يرجع الصلاحيات', async () => {
      const a = buildApp();
      const res = await login(a, 'admin@acme.test');
      expect(res.status).toBe(200);
      expect(res.headers['set-cookie']?.[0]).toMatch(/hrms_rt=.*HttpOnly.*SameSite=Strict/i);
      const me = await request(a)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${res.body.data.accessToken}`);
      expect(me.status).toBe(200);
      expect(me.body.data.permissions).toContain('identity.role.manage');
      expect(me.headers['x-permissions-version']).toBeTruthy();
    });

    it('كلمة مرور خاطئة أو مستخدم/شركة غير موجودين يعطي نفس الخطأ', async () => {
      const a = buildApp();
      for (const res of [
        await login(a, 'admin@acme.test', 'wrong-password-123'),
        await login(a, 'nobody@acme.test'),
        await login(a, 'admin@acme.test', PASSWORD, 'no-such-company'),
      ]) {
        expect(res.status).toBe(401);
        expect(res.body.error.code).toBe('INVALID_CREDENTIALS');
      }
    });

    it('مستخدم شركة أخرى لا يدخل عبر الشركة الافتراضية', async () => {
      const res = await login(buildApp(), 'admin@globex.test');
      expect(res.status).toBe(401);
      const ok = await login(buildApp(), 'admin@globex.test', PASSWORD, 'globex');
      expect(ok.status).toBe(200);
    });

    it('قفل الحساب بعد 5 محاولات فاشلة حتى مع كلمة مرور صحيحة', async () => {
      const a = buildApp();
      for (let i = 0; i < 5; i += 1) await login(a, 'emp@acme.test', 'wrong-password-123');
      const res = await login(a, 'emp@acme.test');
      expect(res.status).toBe(423);
      expect(res.body.error.code).toBe('ACCOUNT_LOCKED');
    });

    it('refresh يدوّر التوكن ويرفض القديم ويبطل العائلة عند إعادة الاستخدام', async () => {
      const a = buildApp();
      const first = await login(a, 'admin@acme.test');
      const cookie1 = first.headers['set-cookie']?.[0]?.split(';')[0] as string;

      const second = await request(a).post('/api/v1/auth/refresh').set('Cookie', cookie1);
      expect(second.status).toBe(200);
      const cookie2 = second.headers['set-cookie']?.[0]?.split(';')[0] as string;
      expect(cookie2).not.toBe(cookie1);

      // نُقدّم زمن إبطال التوكن الأول خارج مهلة السباق لمحاكاة إعادة استخدام حقيقية
      await admin
        .updateTable('refreshTokens')
        .set({ revokedAt: new Date(Date.now() - 60_000) })
        .where('revokedAt', 'is not', null)
        .execute();
      const reuse = await request(a).post('/api/v1/auth/refresh').set('Cookie', cookie1);
      expect(reuse.status).toBe(401);
      // العائلة كلها أُبطلت: التوكن الجديد لم يعد صالحاً
      const afterRevoke = await request(a).post('/api/v1/auth/refresh').set('Cookie', cookie2);
      expect(afterRevoke.status).toBe(401);
    });

    it('logout يبطل الجلسة', async () => {
      const a = buildApp();
      const first = await login(a, 'admin@acme.test');
      const cookie = first.headers['set-cookie']?.[0]?.split(';')[0] as string;
      expect((await request(a).post('/api/v1/auth/logout').set('Cookie', cookie)).status).toBe(204);
      expect((await request(a).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(
        401,
      );
    });

    it('تغيير كلمة المرور يرفض الضعيفة ويبطل الجلسات', async () => {
      const a = buildApp();
      const res = await login(a, 'emp@acme.test');
      const auth = { Authorization: `Bearer ${res.body.data.accessToken}` };
      const weak = await request(a)
        .post('/api/v1/auth/change-password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'password123' });
      expect(weak.status).toBe(400);
      expect(weak.body.error.code).toBe('WEAK_PASSWORD');
      const good = await request(a)
        .post('/api/v1/auth/change-password')
        .set(auth)
        .send({ currentPassword: PASSWORD, newPassword: 'a-much-better-passphrase' });
      expect(good.status).toBe(204);
      expect((await login(a, 'emp@acme.test')).status).toBe(401);
      expect((await login(a, 'emp@acme.test', 'a-much-better-passphrase')).status).toBe(200);
      // إعادة الضبط للاختبارات اللاحقة
      await admin
        .updateTable('users')
        .set({ passwordHash: await hashPassword(PASSWORD) })
        .where('email', '=', 'emp@acme.test')
        .execute();
    });
  });

  describe('requirePermission', () => {
    it('403 عند غياب الصلاحية و200 عند وجودها و401 بلا توكن', async () => {
      const a = buildApp();
      const probe = express();
      probe.use(requestIdMiddleware);
      probe.get(
        '/guarded',
        createAuthenticate(app, settings.jwtSecret),
        requirePermission('identity.role.manage'),
        (_req, res) => void res.json({ data: 'ok' }),
      );
      probe.use(createErrorHandler(logger));

      const token = async (email: string) =>
        (
          await request(a)
            .post('/api/v1/auth/login')
            .send({ identifier: email, password: PASSWORD })
        ).body.data.accessToken as string;

      expect((await request(probe).get('/guarded')).status).toBe(401);
      const emp = await request(probe)
        .get('/guarded')
        .set('Authorization', `Bearer ${await token('emp@acme.test')}`);
      expect(emp.status).toBe(403);
      expect(emp.body.error.code).toBe('FORBIDDEN');
      const adm = await request(probe)
        .get('/guarded')
        .set('Authorization', `Bearer ${await token('admin@acme.test')}`);
      expect(adm.status).toBe(200);
    });
  });
});
