import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('المنظمة والإعدادات والتدقيق', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let globex: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};

  const makeUser = (
    companyId: string,
    email: string,
    roleCode: string,
    scope?: { type: 'branch'; id: string },
  ) =>
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
          scopeType: scope?.type ?? 'company',
          scopeId: scope?.id ?? null,
        })
        .execute();
    });

  const login = async (email: string, company?: string) => {
    const res = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: email, password: PASSWORD, company });
    return res.body.data.accessToken as string;
  };
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));

  let riyadh: string;
  let jeddah: string;

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
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });

    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(globex, 'admin@globex.test', 'admin');
    await makeUser(acme, 'emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['globexAdmin'] = await login('admin@globex.test', 'globex');
    tokens['emp'] = await login('emp@acme.test');

    riyadh = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    jeddah = (await post('admin', '/branches', { code: 'JED', nameAr: 'جدة' })).body.data.id;
    await makeUser(acme, 'jed@acme.test', 'hr_manager', { type: 'branch', id: jeddah });
    tokens['jed'] = await login('jed@acme.test');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('CRUD الفروع', () => {
    it('إنشاء وقراءة وقائمة', async () => {
      const res = await get('admin', '/branches');
      expect(res.status).toBe(200);
      expect(res.body.meta.total).toBe(2);
      expect(res.body.data[0]).not.toHaveProperty('companyId');
    });

    it('رمز مكرر يعطي 409 DUPLICATE، وبيانات خاطئة 400', async () => {
      const dup = await post('admin', '/branches', { code: 'RUH', nameAr: 'مكرر' });
      expect(dup.status).toBe(409);
      expect(dup.body.error.code).toBe('DUPLICATE');
      expect((await post('admin', '/branches', { code: 'bad code!', nameAr: 'x' })).status).toBe(
        400,
      );
    });

    it('القفل المتفائل: تعديل بنسخة قديمة يعطي 409', async () => {
      const ok = await request(api)
        .patch(`/api/v1/branches/${riyadh}`)
        .set(as('admin'))
        .send({ city: 'الرياض', version: 1 });
      expect(ok.status).toBe(200);
      expect(ok.body.data.version).toBe(2);
      const stale = await request(api)
        .patch(`/api/v1/branches/${riyadh}`)
        .set(as('admin'))
        .send({ city: 'x', version: 1 });
      expect(stale.status).toBe(409);
      expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    });

    it('بلا صلاحية 403، وبلا توكن 401', async () => {
      expect((await get('emp', '/branches')).status).toBe(403);
      expect((await request(api).get('/api/v1/branches')).status).toBe(401);
    });

    it('شركة أخرى لا ترى السجل (404) ولا تعدّله', async () => {
      expect((await get('globexAdmin', `/branches/${riyadh}`)).status).toBe(404);
      const r = await request(api)
        .patch(`/api/v1/branches/${riyadh}`)
        .set(as('globexAdmin'))
        .send({ city: 'x', version: 2 });
      expect(r.status).toBe(404);
      expect((await get('globexAdmin', '/branches')).body.meta.total).toBe(0);
    });

    it('نطاق الفرع: مدير فرع جدة يرى جدة فقط والباقي 404', async () => {
      const list = await get('jed', '/branches');
      expect(list.body.data.map((b: { code: string }) => b.code)).toEqual(['JED']);
      expect((await get('jed', `/branches/${jeddah}`)).status).toBe(200);
      expect((await get('jed', `/branches/${riyadh}`)).status).toBe(404);
    });

    it('الحذف: يعمل لغير المستخدم ويرفض المستخدم بـ 409 IN_USE', async () => {
      const tmp = (await post('admin', '/branches', { code: 'TMP', nameAr: 'مؤقت' })).body.data.id;
      expect((await request(api).delete(`/api/v1/branches/${tmp}`).set(as('admin'))).status).toBe(
        204,
      );
      await post('admin', '/work-locations', { code: 'HQ', nameAr: 'المقر', branchId: riyadh });
      const used = await request(api).delete(`/api/v1/branches/${riyadh}`).set(as('admin'));
      expect(used.status).toBe(409);
      expect(used.body.error.code).toBe('IN_USE');
    });
  });

  describe('المراجع بين الشركات', () => {
    it('لا يمكن ربط سجل بفرع/درجة من شركة أخرى', async () => {
      const other = (await post('globexAdmin', '/job-grades', { code: 'G1', nameAr: 'درجة' })).body
        .data.id;
      const res = await post('admin', '/job-titles', {
        code: 'T1',
        nameAr: 'مسمى',
        jobGradeId: other,
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REFERENCE');
      const mine = (await post('admin', '/job-grades', { code: 'G1', nameAr: 'درجة' })).body.data
        .id;
      expect(
        (await post('admin', '/job-titles', { code: 'T1', nameAr: 'مسمى', jobGradeId: mine }))
          .status,
      ).toBe(201);
    });
  });

  describe('الأقسام', () => {
    let root: string;
    it('يلزم فرع واحد على الأقل', async () => {
      expect(
        (await post('admin', '/departments', { code: 'D0', nameAr: 'x', branchIds: [] })).status,
      ).toBe(400);
      const res = await post('admin', '/departments', {
        code: 'HR',
        nameAr: 'الموارد',
        branchIds: [riyadh, jeddah],
      });
      expect(res.status).toBe(201);
      expect(res.body.data.branchIds.sort()).toEqual([riyadh, jeddah].sort());
      root = res.body.data.id;
    });

    it('منع الحلقات في الشجرة', async () => {
      const child = (
        await post('admin', '/departments', {
          code: 'HR1',
          nameAr: 'فرعي',
          parentId: root,
          branchIds: [riyadh],
        })
      ).body.data;
      const res = await request(api)
        .patch(`/api/v1/departments/${root}`)
        .set(as('admin'))
        .send({ parentId: child.id, version: 1 });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_PARENT');
    });

    it('إزالة آخر فرع من القسم مرفوضة بقيد القاعدة', async () => {
      const d = (
        await post('admin', '/departments', { code: 'ONE', nameAr: 'واحد', branchIds: [riyadh] })
      ).body.data;
      const res = await request(api)
        .patch(`/api/v1/departments/${d.id}`)
        .set(as('admin'))
        .send({ branchIds: [], version: 1 });
      expect(res.status).toBe(400);
    });

    it('نطاق الفرع: مدير جدة يرى أقسام جدة فقط', async () => {
      const list = (await get('jed', '/departments')).body.data.map(
        (d: { code: string }) => d.code,
      );
      expect(list).toContain('HR');
      expect(list).not.toContain('HR1');
      expect(list).not.toContain('ONE');
    });

    it('قسم له فروع لا يُحذف', async () => {
      const res = await request(api).delete(`/api/v1/departments/${root}`).set(as('admin'));
      expect(res.status).toBe(409);
    });
  });

  describe('الإعدادات', () => {
    it('الافتراضي ثم الشركة ثم الفرع ثم المستخدم', async () => {
      expect((await get('admin', '/settings/effective')).body.data.dateFormat).toBe('DD/MM/YYYY');
      const put = (who: string, path: string, value: unknown) =>
        request(api).put(`/api/v1/settings${path}`).set(as(who)).send({ value });
      expect((await put('admin', '/company/dateFormat', 'YYYY-MM-DD')).status).toBe(204);
      expect((await get('admin', '/settings/effective')).body.data.dateFormat).toBe('YYYY-MM-DD');
      expect((await put('admin', `/branch/${riyadh}/dateFormat`, 'MM/DD/YYYY')).status).toBe(204);
      expect(
        (await get('admin', `/settings/effective?branchId=${riyadh}`)).body.data.dateFormat,
      ).toBe('MM/DD/YYYY');
      expect((await put('emp', '/me/dateFormat', 'DD/MM/YYYY')).status).toBe(204);
      expect((await get('emp', '/settings/effective')).body.data.dateFormat).toBe('DD/MM/YYYY');
      // تعديل مرة ثانية لا يكرّر الصف
      expect((await put('admin', '/company/dateFormat', 'DD/MM/YYYY')).status).toBe(204);
    });

    it('قيمة أو مفتاح غير صالحين → 400، وتعديل إعداد الشركة بلا صلاحية → 403', async () => {
      const bad = await request(api)
        .put('/api/v1/settings/company/calendar')
        .set(as('admin'))
        .send({ value: 'lunar' });
      expect(bad.status).toBe(400);
      const unknown = await request(api)
        .put('/api/v1/settings/company/nope')
        .set(as('admin'))
        .send({ value: 1 });
      expect(unknown.status).toBe(400);
      const denied = await request(api)
        .put('/api/v1/settings/company/calendar')
        .set(as('emp'))
        .send({ value: 'hijri' });
      expect(denied.status).toBe(403);
    });

    it('مدير فرع جدة لا يعدّل إعدادات فرع الرياض', async () => {
      const res = await request(api)
        .put(`/api/v1/settings/branch/${riyadh}/timeFormat`)
        .set(as('jed'))
        .send({ value: '24h' });
      expect(res.status).toBe(404);
    });
  });

  describe('التدقيق', () => {
    it('تعديل فرع يظهر في سجل التدقيق مع المستخدم والفروق', async () => {
      const res = await get('admin', `/audit-logs?entityType=branches&entityId=${riyadh}`);
      expect(res.status).toBe(200);
      const update = res.body.data.find((r: { action: string }) => r.action === 'update');
      expect(update.userName).toBe('admin@acme.test');
      expect(update.changes.city).toEqual({ old: null, new: 'الرياض' });
    });

    it('بلا صلاحية 403، وسجلات الشركات معزولة', async () => {
      expect((await get('emp', '/audit-logs')).status).toBe(403);
      const g = await get('globexAdmin', `/audit-logs?entityId=${riyadh}`);
      expect(g.body.meta.total).toBe(0);
    });
  });
});
