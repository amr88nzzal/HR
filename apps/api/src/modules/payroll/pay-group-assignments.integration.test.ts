import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { randomBytes } from 'node:crypto';
import { createFieldCrypto } from '../../shared/crypto.js';
import { createLocalStorage } from '../../shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('تعيينات مجموعات الدفع', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const rendered: string[] = [];
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));
  const patch = (who: string, p: string, body: object) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);

  const makeUser = (email: string, roleCode: string) =>
    withTenant(admin, { companyId: acme }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', acme)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId: acme,
          email,
          displayName: `مستخدم ${roleCode}`,
          passwordHash: await hashPassword(PASSWORD),
        })
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

  const ids: Record<string, string> = {};
  let a: string;

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
    const k = () => randomBytes(32).toString('base64');
    const crypto = createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() });
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        crypto,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-payslip-'))),
        render: async (html: string) => {
          rendered.push(html);
          return Buffer.from('%PDF-1.4 fake payslip');
        },
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    await makeUser('emp@acme.test', 'employee');
    await makeUser('other@acme.test', 'employee');
    for (const who of ['admin', 'hr', 'emp', 'other'])
      tokens[who] = await login(`${who}@acme.test`);
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    a = (
      await post('admin', '/employees', {
        firstNameAr: 'أحمد',
        familyNameAr: 'تجربة',
        firstHireDate: '2025-01-01',
      })
    ).body.data.id as string;
    const empUser = await admin
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'emp@acme.test')
      .executeTakeFirstOrThrow();
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx.updateTable('employees').set({ userId: empUser.id }).where('id', '=', a).execute(),
    );
    const comp = async (c: object) =>
      (await post('admin', '/payroll/components', c)).body.data.id as string;
    ids['housing'] = await comp({
      code: 'housing',
      nameAr: 'سكن',
      kind: 'earning',
      calcType: 'fixed',
      fixedAmount: '500',
    });
    ids['insurable'] = (
      await post('admin', '/payroll/bases', {
        code: 'insurable',
        nameAr: 'تأمينات',
        includesBasic: true,
        componentIds: [ids['housing']],
      })
    ).body.data.id;
    ids['social'] = await comp({
      code: 'social',
      nameAr: 'تأمينات',
      kind: 'deduction',
      calcType: 'percent',
      percent: '10',
      baseId: ids['insurable'],
    });
    const sal = await post('admin', `/employees/${a}/salaries`, {
      currency: 'SAR',
      basicAmount: '3000',
      validFrom: '2025-01-01',
      components: ['housing', 'social'].map((k) => ({ componentId: ids[k] })),
    });
    expect(sal.status).toBe(201);
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  const groupId = async (code: string) =>
    (await post('admin', '/payroll/groups', { code, nameAr: `مجموعة ${code}` })).body.data
      .id as string;
  let g1: string;
  let g2: string;
  let first: string;

  it('تعيين موظف: يظهر في القائمة، والتعيين الجديد ينهي السابق قبل تاريخه بيوم', async () => {
    g1 = await groupId('weekly');
    g2 = await groupId('contract');
    const r1 = await post('admin', `/payroll/groups/${g1}/assignments`, {
      employeeId: a,
      validFrom: '2025-01-01',
    });
    expect(r1.status, JSON.stringify(r1.body)).toBe(201);
    first = r1.body.data.id;
    const r2 = await post('admin', `/payroll/groups/${g2}/assignments`, {
      employeeId: a,
      validFrom: '2026-01-01',
    });
    expect(r2.status).toBe(201);
    const list1 = (await get('admin', `/payroll/groups/${g1}/assignments`)).body.data;
    expect(list1).toHaveLength(1);
    expect(list1[0].validTo).toBe('2025-12-31');
    const list2 = (await get('admin', `/payroll/groups/${g2}/assignments`)).body.data;
    expect(list2[0].employeeName).toContain('أحمد');
    expect(list2[0].validTo).toBeNull();
  });

  it('الصلاحيات والمراجع: الموظف العادي ممنوع، وموظف غير موجود 400', async () => {
    expect((await get('emp', `/payroll/groups/${g1}/assignments`)).status).toBe(403);
    expect(
      (
        await post('emp', `/payroll/groups/${g1}/assignments`, {
          employeeId: a,
          validFrom: '2026-02-01',
        })
      ).status,
    ).toBe(403);
    const bad = await post('admin', `/payroll/groups/${g1}/assignments`, {
      employeeId: '018f0000-0000-7000-8000-000000000000',
      validFrom: '2026-02-01',
    });
    expect(bad.status).toBe(400);
  });

  it('دورة مجموعة غير افتراضية تضم المعيَّنين إليها فقط', async () => {
    const p2 = (
      await post('admin', '/payroll/periods', {
        year: 2026,
        month: 3,
        currency: 'SAR',
        payGroupId: g2,
      })
    ).body.data.id as string;
    expect((await post('admin', `/payroll/periods/${p2}/calculate`)).status).toBe(200);
    expect((await get('admin', `/payroll/periods/${p2}/payslips`)).body.data).toHaveLength(1);
    const p1 = (
      await post('admin', '/payroll/periods', {
        year: 2026,
        month: 3,
        currency: 'SAR',
        payGroupId: g1,
      })
    ).body.data.id as string;
    expect((await post('admin', `/payroll/periods/${p1}/calculate`)).status).toBe(200);
    expect((await get('admin', `/payroll/periods/${p1}/payslips`)).body.data).toHaveLength(0);
  });

  it('حذف تعيين: 204 ثم 404', async () => {
    expect((await del('admin', `/payroll/groups/${g1}/assignments/${first}`)).status).toBe(204);
    expect((await del('admin', `/payroll/groups/${g1}/assignments/${first}`)).status).toBe(404);
  });
});
