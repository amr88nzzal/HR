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

const iso = (d: Date) => d.toISOString().slice(0, 10);
const today = iso(new Date(Date.now() + 3 * 3_600_000)); // الرياض
const shift = (d: string, n: number) =>
  iso(new Date(Date.parse(`${d}T00:00:00Z`) + n * 86_400_000));
/** آخر يوم عمل (أحد..خميس) قبل `n` أيام أو أكثر من اليوم */
const workday = (n: number, skip = 0) => {
  let d = shift(today, -n);
  let left = skip;
  for (;;) {
    if (new Date(`${d}T00:00:00Z`).getUTCDay() <= 4) {
      if (left === 0) return d;
      left -= 1;
    }
    d = shift(d, -1);
  }
};

/** اليوم رقم i من أيام العمل السابقة (يبدأ من أمس)؛ أيام متمايزة بغض النظر عن يوم الأسبوع */
const wk = (i: number) => workday(1, i);

describe('الحضور 5e: تعديلات الحضور والعمل الإضافي', () => {
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
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);

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

  let emp: string;
  let mgrEmp: string;
  let branch: string;
  let dept: string;
  const newEmployee = async (userId: string, managerId: string | null) => {
    const id = (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body
      .data.id as string;
    await admin
      .updateTable('employees')
      .set({ firstHireDate: '2026-01-01', userId })
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
  const dayOf = async (employeeId: string, date: string) =>
    (await get('admin', `/attendance/days?employeeId=${employeeId}&from=${date}&to=${date}`)).body
      .data[0] as Record<string, unknown>;
  const decide = async (
    kind: 'attendance-corrections' | 'overtime-requests',
    id: string,
    action: 'approve' | 'reject',
  ) => {
    const list = (await get('emp', `/${kind}/me`)).body.data as Array<{
      id: string;
      approvalRequestId: string;
    }>;
    const r = list.find((x) => x.id === id) as { approvalRequestId: string };
    return post('mgr', `/approvals/${r.approvalRequestId}/actions`, { action, note: 'ملاحظة' });
  };
  const corr = (who: string, body: object) =>
    post(who, '/attendance-corrections', {
      inTime: '08:00',
      outTime: '16:00',
      reason: 'نسيت البصمة',
      ...body,
    });
  const ot = (who: string, body: object) =>
    post(who, '/overtime-requests', { minutes: 120, reason: 'إنجاز مهمة', ...body });
  const setMode = (v: string) =>
    put('admin', '/settings/company/attendanceCorrectionMode', { value: v });

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
    branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    dept = (
      await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
    ).body.data.id;
    mgrEmp = await newEmployee(mgrUser, null);
    emp = await newEmployee(empUser, mgrEmp);

    const dayShift = (
      await post('admin', '/shifts', {
        code: 'DAY',
        nameAr: 'صباحية',
        segments: [{ startTime: '08:00', endTime: '16:00', endsNextDay: false }],
      })
    ).body.data.id;
    const std = (
      await post('admin', '/work-schedules', {
        code: 'STD',
        nameAr: 'قياسي',
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          shiftId: weekday <= 4 ? dayShift : null,
        })),
      })
    ).body.data.id;
    await post('admin', '/schedule-assignments', {
      scheduleId: std,
      scope: 'company',
      validFrom: '2026-01-01',
    });
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('طلب تعديل بموافقة: الغياب يصير حضوراً وتُنشأ بصمات source=correction', async () => {
    const day = wk(0);
    await post('admin', '/attendance/recompute', { employeeId: emp, from: day, to: day });
    expect((await dayOf(emp, day)).status).toBe('absent');
    const r = await corr('emp', { date: day });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'pending', method: 'request' });
    // لا أثر قبل الموافقة
    expect((await dayOf(emp, day)).status).toBe('absent');
    expect((await decide('attendance-corrections', r.body.data.id, 'approve')).status).toBe(200);
    expect(await dayOf(emp, day)).toMatchObject({ status: 'present', workedMinutes: 480 });
    const punches = (
      await get('admin', `/attendance/punches?employeeId=${emp}&from=${day}&to=${day}`)
    ).body.data as Array<{ source: string; direction: string }>;
    expect(punches.map((p) => `${p.source}:${p.direction}`)).toEqual([
      'correction:in',
      'correction:out',
    ]);
    const mine = (await get('emp', '/attendance-corrections/me')).body.data;
    expect(mine[0].status).toBe('approved');
  });

  it('الرفض لا يغيّر شيئاً، والمعلّق المكرر مرفوض، والسحب يتيح إعادة التقديم', async () => {
    const day = wk(1);
    await post('admin', '/attendance/recompute', { employeeId: emp, from: day, to: day });
    const r = await corr('emp', { date: day });
    const dup = await corr('emp', { date: day });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_PENDING');
    await decide('attendance-corrections', r.body.data.id, 'reject');
    expect(
      (await get('emp', '/attendance-corrections/me')).body.data.find(
        (x: { id: string }) => x.id === r.body.data.id,
      ).status,
    ).toBe('rejected');
    expect((await dayOf(emp, day)).status).toBe('absent');
    const again = await corr('emp', { date: day });
    expect(again.status).toBe(201);
    const w = await post('emp', `/attendance-corrections/${again.body.data.id}/withdraw`);
    expect(w.status).toBe(200);
    expect(w.body.data.status).toBe('withdrawn');
    expect((await corr('emp', { date: day })).status).toBe(201);
  });

  it('المهلة: الموظف 14 يوماً، والموارد البشرية بلا حد؛ ولا يوم مستقبلي', async () => {
    const old = shift(today, -40);
    const late = await corr('emp', { date: old });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe('OUT_OF_WINDOW');
    const onBehalf = await corr('admin', { date: old, employeeId: emp });
    expect(onBehalf.status).toBe(201);
    const fut = await corr('emp', { date: shift(today, 1) });
    expect(fut.status).toBe(400);
    expect(fut.body.error.code).toBe('FUTURE_DAY');
    // الموظف لا يقدّم نيابة عن غيره
    expect((await corr('emp', { date: wk(0), employeeId: mgrEmp })).status).toBe(403);
  });

  it('التعديل المباشر: بصلاحية الإدارة فقط، ويُعتمد فوراً', async () => {
    const day = wk(2);
    const body = {
      employeeId: emp,
      date: day,
      inTime: '08:00',
      outTime: '16:00',
      reason: 'عطل في الجهاز',
    };
    expect((await post('emp', '/attendance-corrections/direct', body)).status).toBe(403);
    const r = await post('admin', '/attendance-corrections/direct', body);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ status: 'approved', method: 'direct' });
    expect(await dayOf(emp, day)).toMatchObject({ status: 'present', workedMinutes: 480 });
  });

  it('خيار الطريقة: direct يمنع الطلبات، وrequest يمنع المباشر', async () => {
    expect((await setMode('direct')).status).toBe(204);
    const a = await corr('emp', { date: wk(3) });
    expect(a.status).toBe(409);
    expect(a.body.error.code).toBe('REQUESTS_DISABLED');
    expect((await setMode('request')).status).toBe(204);
    const b = await post('admin', '/attendance-corrections/direct', {
      employeeId: emp,
      date: wk(3),
      inTime: '08:00',
      outTime: '16:00',
      reason: 'x',
    });
    expect(b.status).toBe(409);
    expect(b.body.error.code).toBe('DIRECT_DISABLED');
    expect((await get('emp', '/attendance-corrections/policy')).body.data.mode).toBe('request');
    await setMode('both');
  });

  it('العمل الإضافي: يُحتسب المعتمد فقط وبحد الفائض الفعلي', async () => {
    const d1 = wk(4);
    const d2 = wk(5);
    const d3 = wk(6);
    for (const d of [d1, d2, d3]) {
      await post('admin', '/attendance/punches', { employeeId: emp, date: d, time: '08:00' });
      await post('admin', '/attendance/punches', { employeeId: emp, date: d, time: '19:00' });
      expect(await dayOf(emp, d)).toMatchObject({ surplusMinutes: 180, overtimeMinutes: 0 });
    }
    // لاحق معتمد (120 من 180)
    const a = await ot('emp', { date: d1, minutes: 120 });
    expect(a.status).toBe(201);
    expect(a.body.data.kind).toBe('post');
    await decide('overtime-requests', a.body.data.id, 'approve');
    expect(await dayOf(emp, d1)).toMatchObject({ overtimeMinutes: 120, surplusMinutes: 180 });
    // معتمد بأكثر من الفائض (300 من 180) = 180
    const b = await ot('emp', { date: d2, minutes: 300 });
    await decide('overtime-requests', b.body.data.id, 'approve');
    expect((await dayOf(emp, d2)).overtimeMinutes).toBe(180);
    // مرفوض: الفائض مسجّل ولا يُحتسب
    const c = await ot('emp', { date: d3 });
    await decide('overtime-requests', c.body.data.id, 'reject');
    expect(await dayOf(emp, d3)).toMatchObject({ overtimeMinutes: 0, surplusMinutes: 180 });
    // طلب فعّال مكرر لنفس اليوم
    const dup = await ot('emp', { date: d1 });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE_ACTIVE');
    // بعد الرفض يمكن إعادة الطلب
    expect((await ot('emp', { date: d3 })).status).toBe(201);
  });

  it('الإضافي المسبق: لليوم أو بعده، ويُحتسب عند احتساب اليوم', async () => {
    const r = await ot('emp', { date: shift(today, 2) });
    expect(r.status).toBe(201);
    expect(r.body.data.kind).toBe('pre');
    expect((await ot('emp', { date: shift(today, 90) })).body.error.code).toBe('TOO_FAR');
    expect((await ot('emp', { date: shift(today, -40) })).body.error.code).toBe('OUT_OF_WINDOW');
    const w = await post('emp', `/overtime-requests/${r.body.data.id}/withdraw`);
    expect(w.body.data.status).toBe('withdrawn');
  });

  it('القوائم: الموظف يرى طلباته فقط، والإدارة ترى الكل', async () => {
    expect((await get('emp', '/overtime-requests')).status).toBe(403);
    expect((await get('emp', '/attendance-corrections')).status).toBe(403);
    const all = await get('admin', '/attendance-corrections?status=approved');
    expect(all.status).toBe(200);
    expect(all.body.meta.total).toBeGreaterThanOrEqual(2);
    expect((await get('admin', '/overtime-requests')).body.meta.total).toBeGreaterThanOrEqual(3);
  });
});
