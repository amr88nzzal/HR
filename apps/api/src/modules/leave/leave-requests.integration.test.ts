import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import { runLeaveMaintenance } from './index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('طلبات الإجازة: من الموظف إلى المدير وأثرها على الرصيد', () => {
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

  let annual: string;
  let unpaid: string;
  let emp: string;
  let mgrEmp: string;

  let branch: string;
  let dept: string;
  const newEmployee = async (userId: string, hire: string, managerId: string | null) => {
    const id = (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body
      .data.id as string;
    await admin
      .updateTable('employees')
      .set({ firstHireDate: hire, userId })
      .where('id', '=', id)
      .execute();
    await admin
      .insertInto('employments')
      .values({
        companyId: acme,
        employeeId: id,
        branchId: branch,
        departmentId: dept,
        managerEmployeeId: managerId,
        employmentType: 'full_time',
        validFrom: '2025-01-01',
      })
      .execute();
    return id;
  };
  const balance = async (e = emp) =>
    Number(
      (
        await admin
          .selectFrom('leaveBalances')
          .select('balance')
          .where('employeeId', '=', e)
          .where('leaveTypeId', '=', annual)
          .executeTakeFirst()
      )?.balance ?? '0',
    );
  const submit = (who: string, body: object) =>
    post(who, '/leave-requests', { leaveTypeId: annual, ...body });
  const decide = async (id: string, action: 'approve' | 'reject') => {
    const r = (await get('emp', `/leave-requests/${id}`)).body.data;
    return post('mgr', `/approvals/${r.approvalRequestId}/actions`, { action, note: 'ملاحظة' });
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
    const empUser = await makeUser('emp@acme.test', 'employee');
    const mgrUser = await makeUser('mgr@acme.test', 'manager');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
    tokens['mgr'] = await login('mgr@acme.test');

    annual = (await post('admin', '/leave-types', { code: 'ANNUAL', nameAr: 'سنوية' })).body.data
      .id;
    unpaid = (
      await post('admin', '/leave-types', { code: 'UNPAID', nameAr: 'بلا راتب', isPaid: false })
    ).body.data.id;
    const policyId = (
      await post('admin', '/leave-policies', {
        code: 'STD',
        nameAr: 'قياسية',
        leaveTypeId: annual,
        annualEntitlement: 24,
      })
    ).body.data.id;
    await post('admin', '/leave-policy-assignments', { policyId, scope: 'company' });
    branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    dept = (
      await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
    ).body.data.id;
    mgrEmp = await newEmployee(mgrUser, '2025-01-01', null);
    emp = await newEmployee(empUser, '2026-01-01', mgrEmp);
    await inTx((ctx) => runLeaveMaintenance(ctx, '2026-06-30')); // يناير..يونيو = 12.00 للموظف
    // الراحة الأسبوعية الافتراضية: الجمعة والسبت
    await post('admin', '/holidays', { holidayDate: '2026-06-17', nameAr: 'عطلة' });
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('رصيد البداية 12.00', async () => {
    expect(await balance()).toBe(12);
    const me = await get('emp', '/leave-balances/me');
    expect(me.status).toBe(200);
  });

  it('المعاينة بلا أثر: إجازة تمر بعطلة رسمية لا تحتسبها', async () => {
    const r = await post('emp', '/leave-requests/preview', {
      leaveTypeId: annual,
      startDate: '2026-06-15',
      endDate: '2026-06-18',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      totalDays: '3.00',
      balance: '12.00',
      balanceAfter: '9.00',
      sufficient: true,
    });
    expect(r.body.data.days.map((d: { kind: string }) => d.kind)).toEqual([
      'work',
      'work',
      'holiday',
      'work',
    ]);
    expect(await balance()).toBe(12);
  });

  let reqId: string;
  it('التقديم يحجز الرصيد فوراً ثم يعتمد المدير فيبقى مخصوماً', async () => {
    const r = await submit('emp', { startDate: '2026-06-15', endDate: '2026-06-18' });
    expect(r.status).toBe(201);
    reqId = r.body.data.id;
    expect(r.body.data).toMatchObject({ status: 'pending', chargedDays: '3.00' });
    expect(await balance()).toBe(9);
    const ok = await decide(reqId, 'approve');
    expect(ok.status).toBe(200);
    const d = await get('emp', `/leave-requests/${reqId}`);
    expect(d.body.data.status).toBe('approved');
    expect(d.body.data.daysDetail).toHaveLength(4);
    expect(await balance()).toBe(9);
    const mine = await get('emp', '/leave-requests/me');
    expect(mine.body.data.map((x: { id: string }) => x.id)).toContain(reqId);
  });

  it('تداخل مع طلب قائم = 409', async () => {
    const r = await submit('emp', { startDate: '2026-06-18', endDate: '2026-06-21' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LEAVE_OVERLAP');
  });

  it('رصيد غير كافٍ = 409 ولا أثر', async () => {
    const r = await submit('emp', { startDate: '2026-07-05', endDate: '2026-07-30' });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('INSUFFICIENT_BALANCE');
    expect(await balance()).toBe(9);
  });

  it('الرفض يعيد الرصيد', async () => {
    const r = await submit('emp', { startDate: '2026-07-05', endDate: '2026-07-06' });
    expect(r.status).toBe(201);
    expect(await balance()).toBe(7);
    await decide(r.body.data.id, 'reject');
    expect((await get('emp', `/leave-requests/${r.body.data.id}`)).body.data.status).toBe(
      'rejected',
    );
    expect(await balance()).toBe(9);
  });

  it('سحب الطلب المعلّق يعيد الرصيد', async () => {
    const r = await submit('emp', { startDate: '2026-07-05', endDate: '2026-07-06' });
    expect(await balance()).toBe(7);
    const c = await post('emp', `/leave-requests/${r.body.data.id}/cancel`);
    expect(c.status).toBe(200);
    expect(c.body.data.status).toBe('withdrawn');
    expect(await balance()).toBe(9);
  });

  it('نصف يوم في أول اليوم وآخره', async () => {
    const p = await post('emp', '/leave-requests/preview', {
      leaveTypeId: annual,
      startDate: '2026-07-05',
      endDate: '2026-07-06',
      firstDayHalf: true,
      lastDayHalf: true,
    });
    expect(p.body.data.totalDays).toBe('1.00');
  });

  it('إلغاء المعتمد قبل البدء يعيد الرصيد (التاريخ مستقبلي)', async () => {
    const r = await submit('emp', { startDate: '2099-03-01', endDate: '2099-03-02' });
    expect(r.status).toBe(201);
    await decide(r.body.data.id, 'approve');
    expect(await balance()).toBe(7);
    const c = await post('emp', `/leave-requests/${r.body.data.id}/cancel`);
    expect(c.body.data.status).toBe('cancelled');
    expect(await balance()).toBe(9);
  });

  it('إلغاء إجازة بدأت: للموظف مرفوض وللإدارة مسموح', async () => {
    const denied = await post('emp', `/leave-requests/${reqId}/cancel`);
    expect(denied.status).toBe(409);
    expect(denied.body.error.code).toBe('ALREADY_STARTED');
    const ok = await post('admin', `/leave-requests/${reqId}/cancel`);
    expect(ok.status).toBe(200);
    expect(await balance()).toBe(12);
  });

  it('تجاوز الأيام المخصومة بيد الإدارة فقط', async () => {
    const r = await submit('emp', { startDate: '2026-07-05', endDate: '2026-07-06' });
    const id = r.body.data.id;
    expect(
      (await post('emp', `/leave-requests/${id}/override`, { days: 0, reason: 'x' })).status,
    ).toBe(403);
    const o = await post('admin', `/leave-requests/${id}/override`, {
      days: 0.5,
      reason: 'استثناء',
    });
    expect(o.status).toBe(200);
    expect(o.body.data.chargedDays).toBe('0.50');
    expect(await balance()).toBe(11.5);
    await post('emp', `/leave-requests/${id}/cancel`);
    expect(await balance()).toBe(12);
  });

  it('النوع غير المدفوع لا يمسّ الرصيد ولا يحتاج سياسة', async () => {
    const r = await post('emp', '/leave-requests', {
      leaveTypeId: unpaid,
      startDate: '2026-08-02',
      endDate: '2026-08-03',
    });
    expect(r.status).toBe(201);
    expect(await balance()).toBe(12);
  });

  it('الموارد البشرية تقدّم نيابةً عن موظف، والموظف لا يستطيع', async () => {
    const byAdmin = await post('admin', '/leave-requests', {
      employeeId: emp,
      leaveTypeId: annual,
      startDate: '2026-09-06',
      endDate: '2026-09-06',
    });
    expect(byAdmin.status).toBe(201);
    const byEmp = await post('emp', '/leave-requests', {
      employeeId: mgrEmp,
      leaveTypeId: annual,
      startDate: '2026-09-06',
      endDate: '2026-09-06',
    });
    expect(byEmp.status).toBe(403);
  });

  it('الاطلاع: المالك والمعتمد والإدارة فقط', async () => {
    const mine = await get('emp', '/leave-requests/me');
    const id = mine.body.data[0].id;
    expect((await get('emp', `/leave-requests/${id}`)).status).toBe(200);
    expect((await get('mgr', `/leave-requests/${id}`)).status).toBe(200);
    expect((await get('admin', `/leave-requests/${id}`)).status).toBe(200);
    expect((await get('emp', '/leave-requests')).status).toBe(403);
    const all = await get('admin', '/leave-requests?status=pending');
    expect(all.status).toBe(200);
  });

  it('بلا مدير ولا بديل: NO_APPROVER ويتراجع التقديم كاملاً', async () => {
    // مدير الموظف الأعلى بلا مدير؛ مديره فقط هو الاحتياط (دور مدير الموارد البشرية بلا مستخدمين)
    const before = await balance(mgrEmp);
    const r = await post('mgr', '/leave-requests', {
      leaveTypeId: annual,
      startDate: '2026-09-06',
      endDate: '2026-09-06',
    });
    expect(r.status).toBe(409);
    expect(await balance(mgrEmp)).toBe(before);
    const n = await admin
      .selectFrom('leaveRequests')
      .select((eb) => eb.fn.countAll<string>().as('n'))
      .where('employeeId', '=', mgrEmp)
      .executeTakeFirstOrThrow();
    expect(Number(n.n)).toBe(0);
  });

  describe('التقويم الجماعي وتقرير الأرصدة', () => {
    const range = 'from=2026-08-01&to=2026-09-15';

    it('الإدارة ترى الجميع ومعها العطل والراحة الأسبوعية', async () => {
      const r = await get('admin', `/leave-requests/calendar?${range}`);
      expect(r.status).toBe(200);
      expect(r.body.data.weeklyOff).toEqual([5, 6]);
      const june = await get('admin', '/leave-requests/calendar?from=2026-06-01&to=2026-06-30');
      expect(june.body.data.holidays.map((h: { holidayDate: string }) => h.holidayDate)).toContain(
        '2026-06-17',
      );
      expect(r.body.data.requests.length).toBeGreaterThan(0);
      for (const x of r.body.data.requests) expect(['pending', 'approved']).toContain(x.status);
    });

    it('المدير يرى مرؤوسه المباشر، والموظف يرى نفسه فقط', async () => {
      const m = await get('mgr', `/leave-requests/calendar?${range}`);
      expect(m.status).toBe(200);
      expect(m.body.data.requests.some((x: { employeeId: string }) => x.employeeId === emp)).toBe(
        true,
      );
      const e = await get('emp', `/leave-requests/calendar?${range}`);
      expect(e.status).toBe(200);
      expect(e.body.data.requests.every((x: { employeeId: string }) => x.employeeId === emp)).toBe(
        true,
      );
    });

    it('مرشح القسم، والتحقق من الفترة', async () => {
      const none = await get(
        'admin',
        `/leave-requests/calendar?${range}&departmentId=00000000-0000-4000-8000-000000000000`,
      );
      expect(none.body.data.requests).toHaveLength(0);
      const bad = await get('admin', '/leave-requests/calendar?from=2026-01-01&to=2026-12-31');
      expect(bad.status).toBe(400);
    });

    it('تقرير الأرصدة: صف لكل موظف ونوع مدفوع، ومحمي بالصلاحية', async () => {
      const r = await get('admin', '/leave-balances/report');
      expect(r.status).toBe(200);
      expect(r.body.meta.total).toBe(2);
      const row = r.body.data.find((x: { employeeId: string }) => x.employeeId === emp);
      expect(row).toMatchObject({ leaveTypeId: annual });
      expect(Number(row.balance)).toBe(await balance());
      expect(Number(row.pending)).toBeGreaterThan(0);
      const filtered = await get('admin', `/leave-balances/report?leaveTypeId=${unpaid}`);
      expect(filtered.body.meta.total).toBe(0); // غير المدفوع خارج التقرير
      expect((await get('emp', '/leave-balances/report')).status).toBe(403);
    });
  });
});
