import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { buildRegistry } from '../../jobs/registry.js';
import { PERIODIC_JOBS } from '../../jobs/definitions.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import { adjust, debit, restore, runLeaveMaintenance } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('دفتر الإجازات: استحقاق وترحيل وانتهاء واستهلاك', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object) =>
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
          displayName: email,
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
      return user.id;
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  const inTx = <T>(fn: Parameters<typeof withTenant<T>>[2]) =>
    withTenant(admin, { companyId: acme }, fn);
  const balanceOf = async (emp: string) =>
    (
      await admin
        .selectFrom('leaveBalances')
        .select('balance')
        .where('employeeId', '=', emp)
        .where('leaveTypeId', '=', typeId)
        .executeTakeFirst()
    )?.balance ?? '0.00';
  const entries = (emp: string, type?: string) => {
    let q = admin.selectFrom('leaveLedger').selectAll().where('employeeId', '=', emp);
    if (type) q = q.where('entryType', '=', type as 'accrual');
    return q.orderBy('effectiveDate').orderBy('period').orderBy('days').orderBy('id').execute();
  };
  const latest = async (emp: string, type: string) =>
    (
      await admin
        .selectFrom('leaveLedger')
        .selectAll()
        .where('employeeId', '=', emp)
        .where('entryType', '=', type as 'accrual')
        .orderBy('createdAt', 'desc')
        .orderBy('days')
        .execute()
    )[0];
  const maintain = (today: string) => inTx((ctx) => runLeaveMaintenance(ctx, today));

  let typeId: string;
  let policyId: string;
  let emp: string;
  let empUser: string;

  const newEmployee = async (hire: string | null, extra: object = {}) => {
    const id = (
      await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص', ...extra })
    ).body.data.id as string;
    await admin
      .updateTable('employees')
      .set({ firstHireDate: hire })
      .where('id', '=', id)
      .execute();
    return id;
  };

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
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });
    await makeUser('admin@acme.test', 'admin');
    empUser = await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');

    typeId = (await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'سنوية' })).body.data
      .id;
    policyId = (
      await post('admin', '/leave-policies', {
        code: 'STD',
        nameAr: 'قياسية',
        leaveTypeId: typeId,
        annualEntitlement: 24,
        carryOverMax: 5,
        carryOverValidMonths: 3,
      })
    ).body.data.id;
    await post('admin', '/leave-policy-assignments', { policyId, scope: 'company' });
    emp = await newEmployee('2025-03-01');
    await admin.updateTable('employees').set({ userId: empUser }).where('id', '=', emp).execute();
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('المهمة اليومية معرَّفة ومجدولة', () => {
    expect(buildRegistry(undefined).has('leave.daily')).toBe(true);
    expect(PERIODIC_JOBS.some((j) => j.job === 'leave.daily')).toBe(true);
  });

  describe('الاستحقاق الشهري', () => {
    it('تعيين 1 مارس: مارس..يونيو = 8.00، وإعادة التشغيل لا تكرر', async () => {
      const r = await maintain('2025-06-15');
      expect(r).toMatchObject({ employees: 1, accruals: 4, carryOvers: 0 });
      expect(await balanceOf(emp)).toBe('8.00');
      const again = await maintain('2025-06-15');
      expect(again.accruals).toBe(0);
      expect(await balanceOf(emp)).toBe('8.00');
    });

    it('تعويض الأشهر الفائتة عند غياب التشغيل (حتى ديسمبر)', async () => {
      const r = await maintain('2025-12-31');
      expect(r.accruals).toBe(6); // يوليو..ديسمبر
      expect(await balanceOf(emp)).toBe('20.00');
      const accruals = await entries(emp, 'accrual');
      expect(accruals.map((a) => a.period)).toEqual([
        '2025-03',
        '2025-04',
        '2025-05',
        '2025-06',
        '2025-07',
        '2025-08',
        '2025-09',
        '2025-10',
        '2025-11',
        '2025-12',
      ]);
    });

    it('الموظف المنتهية خدمته أو بلا تاريخ تعيين لا يستحق', async () => {
      const gone = await newEmployee('2025-01-01');
      await admin
        .updateTable('employees')
        .set({ status: 'terminated' })
        .where('id', '=', gone)
        .execute();
      const noHire = await newEmployee(null);
      await maintain('2025-12-31');
      expect(await entries(gone)).toHaveLength(0);
      expect(await entries(noHire)).toHaveLength(0);
    });
  });

  describe('الاستهلاك FIFO والاستعادة', () => {
    const REQ = '11111111-1111-4111-8111-111111111111';

    it('يستهلك الأقدم أولاً عبر دفعتين (2.00 ثم 1.50)', async () => {
      // مارس 1.00 (تناسب: 2.00 كاملة لأن التعيين يوم 1) → أول دفعة 2.00
      await inTx((ctx) =>
        debit(ctx, {
          employeeId: emp,
          leaveTypeId: typeId,
          days: 3.5,
          date: '2025-12-31',
          requestId: REQ,
        }),
      );
      expect(await balanceOf(emp)).toBe('16.50');
      const cons = await entries(emp, 'consumption');
      expect(cons.map((c) => c.days)).toEqual(['-2.00', '-1.50']);
      const lots = await entries(emp, 'accrual');
      expect(cons[0]?.sourceEntryId).toBe(lots[0]?.id);
      expect(cons[1]?.sourceEntryId).toBe(lots[1]?.id);
    });

    it('رصيد غير كافٍ يُرفض 409 ولا يترك أثراً، والسالب المسموح يُسجَّل عجزاً', async () => {
      const before = (await entries(emp)).length;
      await expect(
        inTx((ctx) =>
          debit(ctx, { employeeId: emp, leaveTypeId: typeId, days: 40, date: '2025-12-31' }),
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_BALANCE' });
      expect((await entries(emp)).length).toBe(before);
      expect(await balanceOf(emp)).toBe('16.50');
    });

    it('الإلغاء/الرفض يعيد الرصيد والدفعات، ومرة واحدة فقط', async () => {
      const r = await inTx((ctx) => restore(ctx, REQ, null));
      expect(r.restoredDays).toBe('3.50');
      expect(await balanceOf(emp)).toBe('20.00');
      const again = await inTx((ctx) => restore(ctx, REQ, null));
      expect(again.restoredDays).toBe('0.00');
      expect(await balanceOf(emp)).toBe('20.00');
      // الاستهلاك بعد الاستعادة يعود يأخذ من الأقدم
      await inTx((ctx) =>
        debit(ctx, { employeeId: emp, leaveTypeId: typeId, days: 2, date: '2025-12-31' }),
      );
      const last = await latest(emp, 'consumption');
      expect(last?.sourceEntryId).toBe((await entries(emp, 'accrual'))[0]?.id);
      await inTx((ctx) =>
        adjust(ctx, {
          employeeId: emp,
          leaveTypeId: typeId,
          days: 2,
          reason: 'تصحيح',
          date: '2025-12-31',
          userId: empUser,
        }),
      );
    });
  });

  describe('الترحيل والانتهاء', () => {
    it('مطلع 2026: ينتهي المتبقي عدا سقف الترحيل 5 للمرحَّل مع مدة صلاحية 3 أشهر', async () => {
      // قبل الترحيل: الرصيد 20.00 (استهلاك 2 ثم تعديل +2)
      expect(await balanceOf(emp)).toBe('20.00');
      const r = await maintain('2026-01-02');
      expect(r.carryOvers).toBe(1);
      const carry = (await entries(emp, 'carry_over'))[0];
      expect(carry).toMatchObject({
        days: '5.00',
        period: '2026',
        expiresOn: '2026-04-01',
        effectiveDate: '2026-01-01',
      });
      // 20 - 20 (انتهاء كل القديم) + 5 (مرحَّل) + 2 (استحقاق يناير) = 7
      expect(await balanceOf(emp)).toBe('7.00');
      const expiries = await entries(emp, 'expiry');
      expect(
        expiries.every((e) => e.reason === 'year_end' && e.effectiveDate === '2026-01-01'),
      ).toBe(true);
      // مرة واحدة فقط
      expect((await maintain('2026-01-03')).carryOvers).toBe(0);
      expect(await balanceOf(emp)).toBe('7.00');
    });

    it('المرحَّل الأقدم يُستهلك أولاً، وينتهي المتبقي منه بعد المدة', async () => {
      const REQ = '22222222-2222-4222-8222-222222222222';
      await inTx((ctx) =>
        debit(ctx, {
          employeeId: emp,
          leaveTypeId: typeId,
          days: 2,
          date: '2026-02-10',
          requestId: REQ,
        }),
      );
      const carry = (await entries(emp, 'carry_over'))[0];
      const c = await latest(emp, 'consumption');
      expect(c?.sourceEntryId).toBe(carry?.id);
      expect(await balanceOf(emp)).toBe('5.00');

      // بعد 1 أبريل: المتبقي 3.00 من المرحَّل ينتهي (+ استحقاق فبراير ومارس ينضم)
      const r = await maintain('2026-04-01');
      expect(r.expiries).toBe(1);
      const exp = await latest(emp, 'expiry');
      expect(exp).toMatchObject({ days: '-3.00', reason: 'validity', effectiveDate: '2026-04-01' });
      // الرصيد: 5.00 + فبراير 2 + مارس 2 + أبريل 2 - 3.00 = 8.00
      expect(await balanceOf(emp)).toBe('8.00');
      expect((await maintain('2026-04-01')).expiries).toBe(0);

      // استعادة طلب استهلك من دفعة انتهت: لا تُبعث الأيام المنتهية
      const r2 = await inTx((ctx) => restore(ctx, REQ, null));
      expect(r2.restoredDays).toBe('0.00');
      expect(await balanceOf(emp)).toBe('8.00');
    });
  });

  describe('التعديلات اليدوية والواجهة', () => {
    it('تعديل موجب يضيف دفعة وسالب يخصم FIFO، والسبب إلزامي، والموظف ممنوع', async () => {
      const bad = await post('admin', '/leave-balances/adjustments', {
        employeeId: emp,
        leaveTypeId: typeId,
        days: 1,
        reason: '',
      });
      expect(bad.status).toBe(400);
      expect(
        (
          await post('emp', '/leave-balances/adjustments', {
            employeeId: emp,
            leaveTypeId: typeId,
            days: 1,
            reason: 'x',
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await post('admin', '/leave-balances/adjustments', {
            employeeId: emp,
            leaveTypeId: typeId,
            days: 0,
            reason: 'x',
          })
        ).status,
      ).toBe(400);
      const plus = await post('admin', '/leave-balances/adjustments', {
        employeeId: emp,
        leaveTypeId: typeId,
        days: 1.5,
        reason: 'مكافأة',
      });
      expect(plus.status).toBe(201);
      expect(plus.body.data.balance).toBe('9.50');
      const minus = await post('admin', '/leave-balances/adjustments', {
        employeeId: emp,
        leaveTypeId: typeId,
        days: -10,
        reason: 'خصم زائد',
      });
      expect(minus.status).toBe(201);
      expect(minus.body.data.balance).toBe('-0.50'); // تجاوز HR يسمح بالسالب
    });

    it('أرصدتي والدفتر والعرض الإداري', async () => {
      const mine = await get('emp', '/leave-balances/me');
      expect(mine.status).toBe(200);
      expect(mine.body.data).toHaveLength(1);
      expect(mine.body.data[0]).toMatchObject({ leaveTypeId: typeId, balance: '-0.50' });
      const adminView = await get('admin', `/leave-balances?employeeId=${emp}`);
      expect(adminView.body.data[0].balance).toBe('-0.50');
      expect((await get('emp', `/leave-balances?employeeId=${emp}`)).status).toBe(403);
      const ledger = await get('emp', '/leave-balances/me/ledger?pageSize=5');
      expect(ledger.body.meta.total).toBeGreaterThan(5);
      expect(ledger.body.data).toHaveLength(5);
      expect((await get('admin', '/leave-balances/ledger')).status).toBe(400);
    });

    it('الدفتر للإضافة فقط: التعديل والحذف مرفوضان من قاعدة البيانات', async () => {
      await expect(
        admin
          .updateTable('leaveLedger')
          .set({ reason: 'x' })
          .where('employeeId', '=', emp)
          .execute(),
      ).rejects.toThrow(/append-only/);
      await expect(
        admin.deleteFrom('leaveLedger').where('employeeId', '=', emp).execute(),
      ).rejects.toThrow(/append-only/);
    });

    it('ربط الحساب بموظف مطلوب لأرصدتي', async () => {
      await makeUser('lonely@acme.test', 'employee');
      tokens['lonely'] = await login('lonely@acme.test');
      expect((await get('lonely', '/leave-balances/me')).status).toBe(409);
    });
  });
});
