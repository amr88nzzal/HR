import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from './app.js';
import { createDb, type Db } from './db/index.js';
import { withTenant } from './db/tenant.js';
import { startTestPg, type TestPg } from './test/pg.js';
import { createLocalStorage } from './shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from './modules/identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('أدوات الجداول: الفرز من الخادم وتفضيلات الأعمدة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: object = {}) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const names = (r: { body: { data: Record<string, unknown>[] } }, key: string) =>
    r.body.data.map((x) => x[key]);

  const makeUser = (email: string, roleCode: string, displayName: string) =>
    withTenant(admin, { companyId: acme }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({ companyId: acme, email, displayName, passwordHash: await hashPassword(PASSWORD) })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: acme,
          userId: user.id,
          roleId: role.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  let jan: string;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'شركة أكمي' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    await withTenant(admin, { companyId: acme }, (ctx) => seedDefaultRoles(ctx));
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-tt-'))),
      },
    });
    await makeUser('admin@acme.test', 'admin', 'زيد المدير');
    await makeUser('hr@acme.test', 'hr_officer', 'أمل الموارد');
    for (const who of ['admin', 'hr']) tokens[who] = await login(`${who}@acme.test`);
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    for (const [first, basic] of [
      ['سامر', '3000'],
      ['باسل', '5000'],
      ['ليث', '4000'],
    ] as const) {
      const e = (
        await post('admin', '/employees', {
          firstNameAr: first,
          familyNameAr: 'تجربة',
          firstHireDate: '2025-01-01',
        })
      ).body.data.id as string;
      const s = await post('admin', `/employees/${e}/salaries`, {
        currency: 'SAR',
        basicAmount: basic,
        validFrom: '2025-01-01',
        components: [],
      });
      expect(s.status).toBe(201);
    }
    jan = (await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })).body
      .data.id;
    expect((await post('admin', `/payroll/periods/${jan}/calculate`)).status).toBe(200);
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('كشف الدورة: الأعلى صافياً ثم الأقل، وبالاسم أبجدياً، ومفتاح مجهول 400', async () => {
    const net = (s: string) =>
      get('admin', `/payroll/periods/${jan}/payslips?sort=${s}`).then((r) =>
        names(r as never, 'netAmount').map(Number),
      );
    expect(await net('-net')).toEqual([5000, 4000, 3000]);
    expect(await net('net')).toEqual([3000, 4000, 5000]);
    const byName = await get('admin', `/payroll/periods/${jan}/payslips?sort=name`);
    const list = names(byName as never, 'employeeName') as string[];
    expect(list).toEqual([...list].sort((x, y) => x.localeCompare(y, 'ar')));
    expect((await get('admin', `/payroll/periods/${jan}/payslips?sort=drop`)).status).toBe(400);
    expect((await get('admin', `/payroll/periods/${jan}/payslips?sort=net;--`)).status).toBe(400);
  });

  it('الموظفون: بالاسم تنازلياً وبالحالة، ومفتاح مجهول 400', async () => {
    const r = await get('admin', '/employees?sort=-name');
    const list = names(r as never, 'fullNameAr') as string[];
    expect(list).toEqual([...list].sort((x, y) => y.localeCompare(x, 'ar')));
    expect((await get('admin', '/employees?sort=status')).status).toBe(200);
    expect((await get('admin', '/employees?sort=salary')).status).toBe(400);
  });

  it('المستخدمون والمراجع العامة (الفروع): فرز بقائمة بيضاء', async () => {
    const u = await get('admin', '/users?sort=-email');
    const emails = names(u as never, 'email') as string[];
    expect(emails).toEqual([...emails].sort().reverse());
    expect((await get('admin', '/users?sort=passwordHash')).status).toBe(400);
    for (const code of ['B2', 'A1', 'C3'])
      await post('admin', '/branches', { code, nameAr: `فرع ${code}` });
    const b = await get('admin', '/branches?sort=-code');
    expect(names(b as never, 'code')).toEqual(['C3', 'B2', 'A1']);
    expect((await get('admin', '/branches?sort=companyId')).status).toBe(400);
  });

  it('تفضيلات الأعمدة: حفظ واسترجاع وإعادة ضبط، ولكل مستخدم تفضيلاته', async () => {
    expect((await get('admin', '/table-prefs/employees')).body.data).toEqual({
      order: [],
      hidden: [],
    });
    const body = { order: ['name', 'status'], hidden: ['branch'] };
    expect((await put('admin', '/table-prefs/employees', body)).status).toBe(200);
    expect((await get('admin', '/table-prefs/employees')).body.data).toEqual(body);
    expect((await get('hr', '/table-prefs/employees')).body.data).toEqual({
      order: [],
      hidden: [],
    });
    expect((await put('admin', '/table-prefs/employees', { order: ['a b'] })).status).toBe(400);
    expect((await put('admin', '/table-prefs/BAD ID', body)).status).toBe(400);
    expect(
      (await request(api).delete('/api/v1/table-prefs/employees').set(as('admin'))).status,
    ).toBe(204);
    expect((await get('admin', '/table-prefs/employees')).body.data).toEqual({
      order: [],
      hidden: [],
    });
    expect((await request(api).get('/api/v1/table-prefs/employees')).status).toBe(401);
  });

  it('تفضيلات القائمة الجانبية: افتراضي ثم حفظ لكل مستخدم ثم استعادة', async () => {
    const def = { mode: 'full', groupOrder: [], itemOrder: {}, hidden: [], favorites: [] };
    expect((await get('admin', '/nav-prefs')).body.data).toEqual(def);
    const body = {
      mode: 'icons',
      groupOrder: ['leaveGroup', 'admin'],
      itemOrder: { admin: ['/admin/users', '/admin/roles'] },
      hidden: ['/admin/jobs'],
      favorites: ['/', '/reports'],
    };
    expect((await put('admin', '/nav-prefs', body)).status).toBe(200);
    expect((await get('admin', '/nav-prefs')).body.data).toEqual(body);
    expect((await get('hr', '/nav-prefs')).body.data).toEqual(def);
    expect((await put('admin', '/nav-prefs', { mode: 'wide' })).status).toBe(400);
    expect(
      (
        await put('admin', '/nav-prefs', {
          favorites: Array.from({ length: 13 }, (_, i) => `/p${i}`),
        })
      ).status,
    ).toBe(400);
    expect((await request(api).delete('/api/v1/nav-prefs').set(as('admin'))).status).toBe(204);
    expect((await get('admin', '/nav-prefs')).body.data).toEqual(def);
    expect((await request(api).get('/api/v1/nav-prefs')).status).toBe(401);
  });

  it('ترويسة الطباعة: اسم الشركة لأي مستخدم موثَّق، ومرفوضة بلا توكن', async () => {
    const r = await get('hr', '/company-brand/print-header');
    expect(r.status).toBe(200);
    expect(r.body.data.nameAr).toBe('شركة أكمي');
    expect(r.body.data).not.toHaveProperty('taxNo');
    expect((await request(api).get('/api/v1/company-brand/print-header')).status).toBe(401);
  });
});
