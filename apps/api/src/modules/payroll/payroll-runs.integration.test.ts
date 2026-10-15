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

describe('الرواتب 7b: الدورات والاحتساب والقسائم والتجاوز اليدوي', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const patch = (who: string, p: string, body: object) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));

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
  let b: string;
  let period: string;
  let slipA: string;

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
    const mk = async (first: string, hire: string) =>
      (
        await post('admin', '/employees', {
          firstNameAr: first,
          familyNameAr: 'تجربة',
          firstHireDate: hire,
        })
      ).body.data.id as string;
    a = await mk('أحمد', '2025-01-01');
    b = await mk('بسام', '2026-01-16');
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
    ids['absence'] = await comp({
      code: 'absence',
      nameAr: 'غياب',
      kind: 'deduction',
      calcType: 'formula',
      formula: 'basic / days_in_period * absent_days',
      prorate: false,
    });
    const sal = (emp: string, basic: string, from: string) =>
      post('admin', `/employees/${emp}/salaries`, {
        currency: 'SAR',
        basicAmount: basic,
        validFrom: from,
        components: ['housing', 'social', 'absence'].map((k) => ({ componentId: ids[k] })),
      });
    expect((await sal(a, '3000', '2025-01-01')).status).toBe(201);
    expect((await sal(b, '3100', '2026-01-16')).status).toBe(201);
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx
        .insertInto('attendanceDays')
        .values(
          ['2026-01-04', '2026-01-05'].map((d) => ({
            companyId: acme,
            employeeId: a,
            dayDate: d,
            status: 'absent' as const,
          })),
        )
        .execute(),
    );
    ids['reason'] = (
      await post('admin', '/payroll/override-reasons', { code: 'correction', nameAr: 'تصحيح' })
    ).body.data.id;
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  const slips = async () =>
    (await get('admin', `/payroll/periods/${period}/payslips`)).body.data as Record<
      string,
      string
    >[];
  const slipOf = (rows: Record<string, string>[], emp: string) =>
    rows.find((r) => r['employeeId'] === emp)!;
  const lineOf = async (slip: string, code: string) =>
    (
      (await get('admin', `/payroll/payslips/${slip}`)).body.data.lines as Record<string, unknown>[]
    ).find((l) => l['code'] === code)!;

  it('الصلاحيات: موظف الموارد لا يصل إلى الدورات', async () => {
    expect((await get('hr', '/payroll/periods')).status).toBe(403);
    expect((await get('admin', '/payroll/periods')).status).toBe(200);
  });

  it('إنشاء دورة بالمجموعة الافتراضية ومنع التكرار، ثم الاحتساب والتناسب', async () => {
    const r = await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    expect(r.body.data).toMatchObject({
      startDate: '2026-01-01',
      endDate: '2026-01-31',
      status: 'draft',
    });
    period = r.body.data.id;
    expect(
      (await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })).status,
    ).toBe(409);

    const c = await post('admin', `/payroll/periods/${period}/calculate`);
    expect(c.status).toBe(200);
    expect(c.body.data).toMatchObject({ employees: 2, errors: 0 });
    const rows = await slips();
    slipA = slipOf(rows, a)!['id']!;
    expect(slipOf(rows, a)).toMatchObject({
      basicAmount: '3000.0000',
      grossAmount: '3500.0000',
      deductionsAmount: '550.0000',
      netAmount: '2950.0000',
    });
    // ب: خدمة 16 يوماً من 31 → الأساسي 1600 والسكن 258.06
    expect(slipOf(rows, b)).toMatchObject({ basicAmount: '1600.0000' });
    const housingB = await lineOf(slipOf(rows, b)['id']!, 'housing');
    expect(housingB['amount']).toBe('258.0600');
  });

  it('المدخلات اليدوية تتجاوز الآلي بعد إعادة الاحتساب', async () => {
    expect(
      (
        await request(api)
          .put(`/api/v1/payroll/periods/${period}/inputs`)
          .set(as('admin'))
          .send({ items: [{ employeeId: a, key: 'absent_days', value: '3' }] })
      ).status,
    ).toBe(204);
    await post('admin', `/payroll/periods/${period}/calculate`);
    expect(slipOf(await slips(), a)).toMatchObject({ netAmount: '2850.0000' });
    await request(api)
      .put(`/api/v1/payroll/periods/${period}/inputs`)
      .set(as('admin'))
      .send({ items: [{ employeeId: a, key: 'absent_days', value: null }] });
    await post('admin', `/payroll/periods/${period}/calculate`);
    expect(slipOf(await slips(), a)).toMatchObject({ netAmount: '2950.0000' });
  });

  it('التجاوز اليدوي: يتطلب سبباً، يبقى بعد إعادة الاحتساب، ويُلغى، والبند المضاف', async () => {
    const line = await lineOf(slipA, 'housing');
    const url = `/payroll/payslips/${slipA}/lines/${line['id']}`;
    expect((await patch('admin', url, { amount: '900' })).status).toBe(400);
    const o = await patch('admin', url, { amount: '900', reasonId: ids['reason'], note: 'اتفاق' });
    expect(o.status).toBe(200);
    // السكن 900 → التأمين 10% من 3900 = 390، الصافي = 3900 - 390 - 200 غياب
    expect(o.body.data).toMatchObject({
      grossAmount: '3900.0000',
      netAmount: '3310.0000',
      hasManual: true,
    });
    await post('admin', `/payroll/periods/${period}/calculate`);
    expect(slipOf(await slips(), a)).toMatchObject({ netAmount: '3310.0000', hasManual: true });
    const rep = await get('admin', `/payroll/periods/${period}/overrides`);
    expect(rep.body.data).toHaveLength(1);

    // معرّفات البنود تتجدد مع إعادة الاحتساب؛ نقرأ البند من جديد
    const fresh = await lineOf(slipA, 'housing');
    const rev = await del('admin', `/payroll/payslips/${slipA}/lines/${fresh['id']}/override`);
    expect(rev.body.data).toMatchObject({ netAmount: '2950.0000', hasManual: false });

    const add = await post('admin', `/payroll/payslips/${slipA}/lines`, {
      kind: 'earning',
      nameAr: 'مكافأة',
      amount: '100',
      reasonId: ids['reason'],
    });
    expect(add.status).toBe(201);
    expect(add.body.data.netAmount).toBe('3050.0000');
    const added = (add.body.data.lines as Record<string, unknown>[]).find((l) => l['isAdded'])!;
    const gone = await del('admin', `/payroll/payslips/${slipA}/lines/${added['id']}`);
    expect(gone.body.data.netAmount).toBe('2950.0000');
  });

  it('المقارنة والمحاكاة: المحاكاة بلا كتابة والمقارنة بالدورة السابقة', async () => {
    const feb = await post('admin', '/payroll/periods', { year: 2026, month: 2, currency: 'SAR' });
    const sim = await post('admin', `/payroll/periods/${feb.body.data.id}/simulate`);
    expect(sim.status).toBe(200);
    expect(sim.body.data.slips).toHaveLength(2);
    const after = await get('admin', `/payroll/periods/${feb.body.data.id}/payslips`);
    expect(after.body.data).toHaveLength(0);
    await post('admin', `/payroll/periods/${feb.body.data.id}/calculate`);
    const cmp = await get('admin', `/payroll/periods/${feb.body.data.id}/compare`);
    expect(cmp.body.data.previousPeriodId).toBe(period);
    // يناير: ب بتناسب وأ بغياب؛ فبراير بلا أيّ منهما فيختلف صافي الاثنين
    const got = cmp.body.data.rows.map((x: Record<string, string>) => x['employeeId']).sort();
    expect(got).toEqual([a, b].sort());
  });

  it('الاعتماد والقفل وإعادة الفتح: التعديلات محجوبة خارج المسودة وسبب إعادة الفتح إلزامي', async () => {
    expect((await post('admin', `/payroll/periods/${period}/approve`)).status).toBe(200);
    expect((await post('admin', `/payroll/periods/${period}/calculate`)).status).toBe(409);
    const line = await lineOf(slipA, 'housing');
    expect(
      (
        await patch('admin', `/payroll/payslips/${slipA}/lines/${line['id']}`, {
          amount: '1',
          reasonId: ids['reason'],
        })
      ).status,
    ).toBe(409);
    expect((await post('admin', `/payroll/periods/${period}/lock`)).status).toBe(200);
    expect((await post('admin', `/payroll/periods/${period}/reopen`, {})).status).toBe(400);
    const re = await post('admin', `/payroll/periods/${period}/reopen`, { reason: 'تصحيح خطأ' });
    expect(re.status).toBe(200);
    expect(re.body.data).toMatchObject({ status: 'draft', reopenReason: 'تصحيح خطأ' });
    expect((await post('admin', `/payroll/periods/${period}/calculate`)).status).toBe(200);
  });
});
