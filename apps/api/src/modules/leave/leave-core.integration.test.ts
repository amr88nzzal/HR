import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import { resolvePolicy } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('نواة الإجازات: أنواع وسياسات وعطل', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let globex: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));

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
    });
  const login = async (email: string, company?: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;

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
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  let annualType: string;
  const policy = (code: string, extra: object = {}) =>
    post('admin', '/leave-policies', {
      code,
      nameAr: code,
      leaveTypeId: annualType,
      annualEntitlement: 21,
      ...extra,
    });

  it('أنواع الإجازات: إنشاء وتكرار ورمز خاطئ وصلاحيات', async () => {
    const res = await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'سنوية' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ isPaid: true, allowHalfDay: true });
    annualType = res.body.data.id;
    expect((await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'x' })).status).toBe(409);
    expect((await post('admin', '/leave-types', { code: 'bad code', nameAr: 'x' })).status).toBe(
      400,
    );
    // الموظف يقرأ ولا يكتب
    expect((await get('emp', '/leave-types')).status).toBe(200);
    expect((await post('emp', '/leave-types', { code: 'X', nameAr: 'x' })).status).toBe(403);
    expect((await get('emp', '/leave-policies')).status).toBe(403);
  });

  it('السياسات: قيم افتراضية، نوع غير موجود، ورفض استحقاق سالب', async () => {
    const ok = await policy('STD', { carryOverMax: 5, carryOverValidMonths: 3 });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({
      accrualMethod: 'monthly',
      annualEntitlement: '21.00',
      carryOverMax: '5.00',
      carryOverValidMonths: 3,
    });
    const bad = await post('admin', '/leave-policies', {
      code: 'BAD',
      nameAr: 'x',
      leaveTypeId: '00000000-0000-4000-8000-000000000000',
      annualEntitlement: 10,
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('INVALID_REFERENCE');
    expect((await policy('NEG', { annualEntitlement: -1 })).status).toBe(400);
  });

  it('العطل الرسمية: تاريخ فريد وتحقق الصيغة', async () => {
    const h = await post('admin', '/holidays', {
      holidayDate: '2026-12-02',
      nameAr: 'اليوم الوطني',
    });
    expect(h.status).toBe(201);
    expect(
      (await post('admin', '/holidays', { holidayDate: '2026-12-02', nameAr: 'مكرر' })).status,
    ).toBe(409);
    expect(
      (await post('admin', '/holidays', { holidayDate: '02/12/2026', nameAr: 'x' })).status,
    ).toBe(400);
    const list = await get('emp', '/holidays');
    expect(list.status).toBe(200);
    expect(list.body.data).toHaveLength(1);
  });

  it('الراحة الأسبوعية: افتراضي الجمعة والسبت وقابل للتعديل ويُرفض الخاطئ', async () => {
    const eff = await get('emp', '/settings/effective');
    expect(eff.body.data.weeklyOff).toEqual([5, 6]);
    const put = (value: unknown) =>
      request(api).put('/api/v1/settings/company/weeklyOff').set(as('admin')).send({ value });
    expect((await put([6])).status).toBe(204);
    expect((await get('emp', '/settings/effective')).body.data.weeklyOff).toEqual([6]);
    expect((await put([0, 1, 2, 3, 4, 5, 6])).status).toBe(400);
    expect((await put([5, 5])).status).toBe(400);
    expect((await put([7])).status).toBe(400);
  });

  describe('تعيين السياسات وحلّها', () => {
    let branch: string;
    let dept: string;
    let emp: string;
    let pCompany: string;
    let pBranch: string;
    let pEmp: string;

    beforeAll(async () => {
      branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
      dept = (
        await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
      ).body.data.id;
      emp = (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body.data
        .id;
      await withTenant(admin, { companyId: acme }, (ctx) =>
        ctx.trx
          .insertInto('employments')
          .values({
            companyId: acme,
            employeeId: emp,
            branchId: branch,
            departmentId: dept,
            employmentType: 'full_time',
            validFrom: '2026-01-01',
          })
          .execute(),
      );
      pCompany = (await policy('P-ALL')).body.data.id;
      pBranch = (await policy('P-BR', { annualEntitlement: 25 })).body.data.id;
      pEmp = (await policy('P-EMP', { annualEntitlement: 30 })).body.data.id;
    });

    const resolve = (date = '2026-06-01') =>
      withTenant(admin, { companyId: acme }, (ctx) => resolvePolicy(ctx, emp, annualType, date));

    it('الأخص يغلب: شركة ثم فرع ثم موظف', async () => {
      const a = await post('admin', '/leave-policy-assignments', {
        policyId: pCompany,
        scope: 'company',
      });
      expect(a.status).toBe(201);
      expect(await resolve()).toMatchObject({ policyId: pCompany, scope: 'company' });
      expect(
        (
          await post('admin', '/leave-policy-assignments', {
            policyId: pBranch,
            scope: 'branch',
            scopeRef: branch,
          })
        ).status,
      ).toBe(201);
      expect(await resolve()).toMatchObject({ policyId: pBranch, scope: 'branch' });
      const e = await post('admin', '/leave-policy-assignments', {
        policyId: pEmp,
        scope: 'employee',
        scopeRef: emp,
      });
      expect(await resolve()).toMatchObject({ policyId: pEmp, scope: 'employee' });
      // حذف تعيين الموظف يعيد لسياسة الفرع
      expect(
        (
          await request(api)
            .delete(`/api/v1/leave-policy-assignments/${e.body.data.id}`)
            .set(as('admin'))
        ).status,
      ).toBe(204);
      expect(await resolve()).toMatchObject({ policyId: pBranch });
    });

    it('تواريخ السريان، والسياسة المعطلة تُتجاهل', async () => {
      const later = await post('admin', '/leave-policy-assignments', {
        policyId: pEmp,
        scope: 'employee',
        scopeRef: emp,
        validFrom: '2027-01-01',
      });
      expect(later.status).toBe(201);
      expect(await resolve('2026-12-31')).toMatchObject({ policyId: pBranch });
      expect(await resolve('2027-01-01')).toMatchObject({ policyId: pEmp });
      const row = (await get('admin', `/leave-policies/${pEmp}`)).body.data;
      await request(api)
        .patch(`/api/v1/leave-policies/${pEmp}`)
        .set(as('admin'))
        .send({ isActive: false, version: row.version });
      expect(await resolve('2027-01-01')).toMatchObject({ policyId: pBranch });
    });

    it('رفض: تعيين مكرر، ومرجع غير صالح، ونطاق بلا مرجع', async () => {
      const dup = await post('admin', '/leave-policy-assignments', {
        policyId: pCompany,
        scope: 'company',
      });
      expect(dup.status).toBe(409);
      expect(
        (await post('admin', '/leave-policy-assignments', { policyId: pCompany, scope: 'branch' }))
          .status,
      ).toBe(400);
      expect(
        (
          await post('admin', '/leave-policy-assignments', {
            policyId: pCompany,
            scope: 'department',
            scopeRef: branch,
          })
        ).status,
      ).toBe(400);
    });

    it('حذف نوع مستخدم في سياسة يعطي 409 IN_USE', async () => {
      const res = await request(api).delete(`/api/v1/leave-types/${annualType}`).set(as('admin'));
      expect(res.status).toBe(409);
    });
  });

  it('العزل: شركة أخرى لا ترى ولا تُعيّن على بيانات acme', async () => {
    expect((await get('globexAdmin', '/leave-types')).body.meta.total).toBe(0);
    expect((await get('globexAdmin', '/holidays')).body.meta.total).toBe(0);
    const cross = await post('globexAdmin', '/leave-policies', {
      code: 'X',
      nameAr: 'x',
      leaveTypeId: annualType,
      annualEntitlement: 10,
    });
    expect(cross.status).toBe(400);
  });
});
