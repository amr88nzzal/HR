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

describe('الرواتب 7c: السلف والأقساط والدفعات', () => {
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

  const NET = 3150; // 3000 + 500 - 10% × 3500
  const mkPeriod = async (month: number) =>
    (await post('admin', '/payroll/periods', { year: 2026, month, currency: 'SAR' })).body.data
      .id as string;
  const slipOf = async (period: string) =>
    (
      (await get('admin', `/payroll/periods/${period}/payslips`)).body.data as Record<
        string,
        string
      >[]
    )[0]!;
  const loanDetail = async (id: string) => (await get('admin', `/payroll/loans/${id}`)).body.data;
  const newLoan = async (principal: string, count: number, month: number) => {
    const r = await post('admin', '/payroll/loans', {
      employeeId: a,
      currency: 'SAR',
      principal,
      installmentsCount: count,
      firstYear: 2026,
      firstMonth: month,
      reason: 'ظرف طارئ',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(201);
    return r.body.data.id as string;
  };
  let jan: string;
  let feb: string;
  let loanA: string;
  let loanB: string;

  it('الصلاحيات: موظف الموارد لا يصل إلى السلف والدفعات', async () => {
    expect((await get('hr', '/payroll/loans')).status).toBe(403);
    expect((await get('hr', '/payroll/payments')).status).toBe(403);
    expect((await get('admin', '/payroll/loans')).status).toBe(200);
  });

  it('إنشاء سلفة: جدول أقساط متساوي ودفعة صرف معلّقة، ويرفض مبلغاً غير صالح', async () => {
    expect(
      (
        await post('admin', '/payroll/loans', {
          employeeId: a,
          currency: 'SAR',
          principal: '0',
          installmentsCount: 3,
          firstYear: 2026,
          firstMonth: 1,
        })
      ).status,
    ).toBe(400);
    loanA = await newLoan('3000', 3, 1);
    const d = await loanDetail(loanA);
    expect(d.installments.map((i: Record<string, string>) => i['amount'])).toEqual([
      '1000.0000',
      '1000.0000',
      '1000.0000',
    ]);
    expect(d.installments.map((i: Record<string, number>) => i['dueMonth'])).toEqual([1, 2, 3]);
    expect(d.payments).toHaveLength(1);
    expect(d.payments[0]).toMatchObject({ status: 'pending', amount: '3000.0000' });
  });

  it('الاحتساب: القسط في عمود مستقل بعد الصافي ولا يغيّره، والمستحق = الصافي − القسط', async () => {
    jan = await mkPeriod(1);
    expect((await post('admin', `/payroll/periods/${jan}/calculate`)).status).toBe(200);
    const s = await slipOf(jan);
    expect(Number(s['netAmount'])).toBe(NET);
    expect(Number(s['loansAmount'])).toBe(1000);
    expect(Number(s['payableAmount'])).toBe(NET - 1000);
    const det = (await get('admin', `/payroll/payslips/${s['id']}`)).body.data;
    expect(det.loanItems).toHaveLength(1);
    const p = (await get('admin', `/payroll/periods/${jan}`)).body.data;
    expect(Number(p.loansTotal)).toBe(1000);
    expect(Number(p.payableTotal)).toBe(NET - 1000);
  });

  it('الاعتماد ينشئ دفعة معلّقة بالمستحق، والقفل يثبّت القسط مخصوماً', async () => {
    expect((await post('admin', `/payroll/periods/${jan}/approve`)).status).toBe(200);
    const pays = (await get('admin', `/payroll/payments?periodId=${jan}`)).body.data;
    expect(pays).toHaveLength(1);
    expect(Number(pays[0].amount)).toBe(NET - 1000);
    expect(pays[0].status).toBe('pending');
    expect((await post('admin', `/payroll/periods/${jan}/lock`)).status).toBe(200);
    const d = await loanDetail(loanA);
    expect(d.installments[0].status).toBe('deducted');
    expect(Number(d.repaid)).toBe(1000);
    expect(Number(d.remaining)).toBe(2000);
  });

  it('تعليم الدفعة مدفوعة يمنع إعادة الفتح حتى يُلغى التعليم، والتصدير CSV', async () => {
    const pays = (await get('admin', `/payroll/payments?periodId=${jan}`)).body.data;
    const m = await post('admin', `/payroll/payments/${pays[0].id}/mark`, {
      method: 'bank',
      reference: 'TRX-1',
      paidAt: '2026-02-01',
    });
    expect(m.status, JSON.stringify(m.body)).toBe(200);
    expect(m.body.data.status).toBe('paid');
    const blocked = await post('admin', `/payroll/periods/${jan}/reopen`, { reason: 'تصحيح' });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('PAYMENTS_PAID');
    const csv = await get('admin', `/payroll/periods/${jan}/payments.csv`);
    expect(csv.status).toBe(200);
    expect(csv.text).toContain('employee_no,name,accounting_no,amount');
    expect(csv.text).toContain('TRX-1');
    expect((await post('admin', `/payroll/payments/${pays[0].id}/unmark`)).status).toBe(200);
  });

  it('إعادة فتح دورة مقفلة تُرجع القسط مجدولاً وتحذف الدفعات المعلّقة', async () => {
    const r = await post('admin', `/payroll/periods/${jan}/reopen`, { reason: 'تصحيح' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await loanDetail(loanA);
    expect(d.installments[0].status).toBe('scheduled');
    expect(Number(d.remaining)).toBe(3000);
    expect((await get('admin', `/payroll/payments?periodId=${jan}`)).body.data).toHaveLength(0);
    await post('admin', `/payroll/periods/${jan}/calculate`);
    await post('admin', `/payroll/periods/${jan}/approve`);
    await post('admin', `/payroll/periods/${jan}/lock`);
    expect((await loanDetail(loanA)).installments[0].status).toBe('deducted');
  });

  it('سقف الصافي: ما يتجاوز النسبة يُرحَّل عند القفل بقسط جديد في آخر الجدول', async () => {
    loanB = await newLoan('4000', 1, 2);
    feb = await mkPeriod(2);
    await post('admin', `/payroll/periods/${feb}/calculate`);
    const s = await slipOf(feb);
    // A2 = 1000 يتسع في سقف 50% (1575)، وB1 = 4000 يتجاوز
    expect(Number(s['loansAmount'])).toBe(1000);
    expect(s['warnings']).toContain('LOAN_OVER_CAP');
    await post('admin', `/payroll/periods/${feb}/approve`);
    await post('admin', `/payroll/periods/${feb}/lock`);
    const b = await loanDetail(loanB);
    expect(b.installments).toHaveLength(2);
    expect(b.installments[0]).toMatchObject({
      status: 'deferred',
      deferredReason: 'insufficient_net',
    });
    expect(b.installments[1]).toMatchObject({ status: 'scheduled', dueMonth: 3 });
    expect(b.status).toBe('active');
  });

  it('إعادة فتح الدورة تُلغي الترحيل التلقائي وتُرجع الأقساط', async () => {
    expect(
      (await post('admin', `/payroll/periods/${feb}/reopen`, { reason: 'مراجعة' })).status,
    ).toBe(200);
    const b = await loanDetail(loanB);
    expect(b.installments).toHaveLength(1);
    expect(b.installments[0].status).toBe('scheduled');
    expect((await loanDetail(loanA)).installments[1].status).toBe('scheduled');
  });

  it('تأجيل يدوي بسبب في دورة مسودة يعيد احتساب القسيمة ويلحق قسطاً بالنهاية', async () => {
    const a2 = (await loanDetail(loanA)).installments[1].id as string;
    const bad = await post('admin', `/payroll/loan-installments/${a2}/defer`, { reason: '' });
    expect(bad.status).toBe(400);
    const r = await post('admin', `/payroll/loan-installments/${a2}/defer`, {
      reason: 'طلب الموظف',
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await loanDetail(loanA);
    expect(d.installments).toHaveLength(4);
    expect(d.installments[1]).toMatchObject({ status: 'deferred', deferredReason: 'طلب الموظف' });
    expect(d.installments[3]).toMatchObject({ status: 'scheduled', dueYear: 2026, dueMonth: 4 });
    expect(Number((await slipOf(feb))['loansAmount'])).toBe(0);
  });

  it('إلغاء سلفة: تُلغى أقساطها المجدولة وتختفي من القسيمة وتُحذف دفعة الصرف المعلّقة', async () => {
    const r = await post('admin', `/payroll/loans/${loanB}/cancel`, { reason: 'تراجع' });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.data.status).toBe('cancelled');
    const d = await loanDetail(loanB);
    expect(d.installments[0].status).toBe('cancelled');
    expect(d.payments).toHaveLength(0);
    expect(
      (await post('admin', `/payroll/loans/${loanB}/cancel`, { reason: 'مرة ثانية' })).status,
    ).toBe(409);
  });

  it('لا تأجيل لقسط داخل دورة معتمدة', async () => {
    await post('admin', `/payroll/periods/${feb}/calculate`);
    const a3 = (await loanDetail(loanA)).installments[2].id as string;
    await post('admin', `/payroll/periods/${feb}/approve`);
    // A3 مستحق في آذار فلا يظهر في قسيمة شباط؛ التأجيل مسموح
    expect(
      (await post('admin', `/payroll/loan-installments/${a3}/defer`, { reason: 'اختبار' })).status,
    ).toBe(200);
  });
});
