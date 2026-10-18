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

describe('نقص الدوام: تأخير ومغادرة مبكرة', () => {
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
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    for (const who of ['admin', 'hr']) tokens[who] = await login(`${who}@acme.test`);
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
    const sal = await post('admin', `/employees/${a}/salaries`, {
      currency: 'SAR',
      basicAmount: '3000',
      validFrom: '2025-01-01',
      components: [],
    });
    expect(sal.status, JSON.stringify(sal.body)).toBe(201);
    ids['annual'] = (
      await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'سنوية' })
    ).body.data.id;
    await post('admin', '/leave-balances/adjustments', {
      employeeId: a,
      leaveTypeId: ids['annual'],
      days: 1,
      reason: 'رصيد افتتاحي',
    });
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx
        .insertInto('attendanceDays')
        .values([
          ...['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07'].map((d) => ({
            companyId: acme,
            employeeId: a,
            dayDate: d,
            status: 'present' as const,
            lateMinutes: 30,
          })),
          {
            companyId: acme,
            employeeId: a,
            dayDate: '2026-10-08',
            status: 'present' as const,
            earlyLeaveMinutes: 60,
          },
        ])
        .execute(),
    );
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  const put = (who: string, p: string, body: object = {}) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const policy = {
    isEnabled: true,
    method: 'minutes',
    countLate: true,
    countEarly: true,
    monthlyFreeMinutes: 60,
    minutesPerDay: 480,
    tiers: [],
    defaultTarget: 'salary',
    suggestActionAfter: 5,
  };
  let oct: string;
  const slip = async () =>
    (
      (await get('admin', `/payroll/periods/${oct}/payslips`)).body.data as Record<string, string>[]
    )[0]!;
  const balance = async () =>
    Number(
      (
        (await get('admin', `/leave-balances?employeeId=${a}`)).body.data as Record<
          string,
          string
        >[]
      ).find((b) => b['leaveTypeId'] === ids['annual'])!['balance'],
    );
  const detail = async () =>
    (await get('admin', `/payroll/payslips/${(await slip())['id']}`)).body.data;

  it('الصلاحيات والسياسة الافتراضية', async () => {
    expect((await get('hr', '/payroll/shortfall/policy')).status).toBe(403);
    const d = await get('admin', '/payroll/shortfall/policy');
    expect(d.status).toBe(200);
    expect(d.body.data.isEnabled).toBe(false);
    expect(
      (await put('hr', '/payroll/shortfall/policy', { ...policy, leaveTypeId: null })).status,
    ).toBe(403);
  });

  it('التحقق: السياسة الافتراضية للرصيد تحتاج نوع إجازة', async () => {
    const r = await put('admin', '/payroll/shortfall/policy', {
      ...policy,
      defaultTarget: 'leave',
      leaveTypeId: null,
    });
    expect(r.status).toBe(400);
  });

  it('حفظ السياسة وتقرير الشهر: دقائق مجمّعة وسماحية وأيام مستحقة', async () => {
    const r = await put('admin', '/payroll/shortfall/policy', {
      ...policy,
      leaveTypeId: ids['annual'],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const rep = await get('admin', '/payroll/shortfall/report?year=2026&month=10');
    expect(rep.status).toBe(200);
    expect(rep.body.data).toHaveLength(1);
    expect(rep.body.data[0]).toMatchObject({
      lateMinutes: 120,
      earlyMinutes: 60,
      occurrences: 5,
      chargeableMinutes: 120,
      daysDue: '0.2500',
      target: 'salary',
      suggestAction: true,
    });
    const none = await get(
      'admin',
      `/payroll/shortfall/report?year=2026&month=10&departmentId=${a}`,
    );
    expect(none.body.data).toHaveLength(0);
  });

  it('الاحتساب: بند خصم نقص الدوام من الراتب (ربع يوم = 25) ومتغيرات الدقائق', async () => {
    oct = (await post('admin', '/payroll/periods', { year: 2026, month: 10, currency: 'SAR' })).body
      .data.id;
    expect((await post('admin', `/payroll/periods/${oct}/calculate`)).status).toBe(200);
    expect(Number((await slip())['netAmount'])).toBe(2975);
    const d = await detail();
    const line = d.lines.find((l: Record<string, string>) => l['code'] === 'shortfall_deduction');
    expect(Number(line['amount'])).toBe(25);
    expect(d.inputs.variables.shortfallMinutes).toBe('180');
    expect(d.inputs.variables.earlyLeaveMinutes).toBe('60');
  });

  it('قرار الرصيد: لا خصم من الراتب، وإعادة احتساب المسودة تلقائياً', async () => {
    const r = await put('admin', '/payroll/shortfall/decisions', {
      employeeId: a,
      year: 2026,
      month: 10,
      target: 'leave',
      reason: 'اتفاق مع المدير',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(Number((await slip())['netAmount'])).toBe(3000);
    const rep = await get('admin', '/payroll/shortfall/report?year=2026&month=10');
    expect(rep.body.data[0]).toMatchObject({
      target: 'leave',
      daysLeave: '0.25',
      daysSalary: '0.0000',
      decided: true,
    });
  });

  it('رصيد غير كافٍ: يُخصم المتاح والباقي من الراتب مع تحذير', async () => {
    await post('admin', '/leave-balances/adjustments', {
      employeeId: a,
      leaveTypeId: ids['annual'],
      days: -0.9,
      reason: 'تقليص',
    });
    expect((await post('admin', `/payroll/periods/${oct}/calculate`)).status).toBe(200);
    const d = await detail();
    const line = d.lines.find((l: Record<string, string>) => l['code'] === 'shortfall_deduction');
    expect(Number(line['amount'])).toBeCloseTo(15, 4); // 0.15 يوم × 100
    expect(d.warnings).toContain('SHORTFALL_BALANCE_INSUFFICIENT');
    await post('admin', '/leave-balances/adjustments', {
      employeeId: a,
      leaveTypeId: ids['annual'],
      days: 0.9,
      reason: 'استعادة',
    });
    expect((await post('admin', `/payroll/periods/${oct}/calculate`)).status).toBe(200);
    expect(Number((await slip())['netAmount'])).toBe(3000);
  });

  it('القفل يخصم من رصيد الإجازات، ويمنع القرار، وإعادة الفتح تعيد الرصيد', async () => {
    expect(await balance()).toBe(1);
    expect((await post('admin', `/payroll/periods/${oct}/approve`)).status).toBe(200);
    const blocked = await put('admin', '/payroll/shortfall/decisions', {
      employeeId: a,
      year: 2026,
      month: 10,
      target: 'waive',
      reason: 'إعفاء',
    });
    expect(blocked.status).toBe(409);
    expect((await post('admin', `/payroll/periods/${oct}/lock`)).status).toBe(200);
    expect(await balance()).toBe(0.75);
    const re = await post('admin', `/payroll/periods/${oct}/reopen`, { reason: 'تصحيح' });
    expect(re.status, JSON.stringify(re.body)).toBe(200);
    expect(await balance()).toBe(1);
  });

  it('الإعفاء وإلغاء القرار', async () => {
    const w = await put('admin', '/payroll/shortfall/decisions', {
      employeeId: a,
      year: 2026,
      month: 10,
      target: 'waive',
      reason: 'ظرف قاهر',
    });
    expect(w.status).toBe(200);
    expect(Number((await slip())['netAmount'])).toBe(3000);
    const del = await request(api)
      .delete(`/api/v1/payroll/shortfall/decisions?employeeId=${a}&year=2026&month=10`)
      .set(as('admin'));
    expect(del.status).toBe(200);
    expect(Number((await slip())['netAmount'])).toBe(2975);
  });
});
