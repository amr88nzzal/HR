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

describe('الحضور 5b: التسجيل اليدوي ومحرك الاحتساب', () => {
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

  let empA: string;
  let empB: string;
  let empNo: string;
  let empUser: string;
  let leaveType: string;

  const punch = (who: string, employeeId: string, date: string, time: string, extra = {}) =>
    post(who, '/attendance/punches', { employeeId, date, time, ...extra });
  const days = async (employeeId: string, from: string, to: string) =>
    (await get('admin', `/attendance/days?employeeId=${employeeId}&from=${from}&to=${to}`)).body
      .data as Array<Record<string, unknown>>;
  const dayOf = async (employeeId: string, date: string) =>
    (await days(employeeId, date, date))[0] as Record<string, unknown>;
  const week = (work: number[], shiftId: string) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      shiftId: work.includes(weekday) ? shiftId : null,
    }));

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

    const mk = async () =>
      (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body.data as {
        id: string;
        employeeNo: string;
      };
    const a = await mk();
    empA = a.id;
    empNo = a.employeeNo;
    empB = (await mk()).id;
    await admin.updateTable('employees').set({ userId: empUser }).where('id', '=', empA).execute();

    const dayShift = (
      await post('admin', '/shifts', {
        code: 'DAY',
        nameAr: 'صباحية',
        lateGraceMinutes: 10,
        earlyLeaveGraceMinutes: 10,
        segments: [{ startTime: '08:00', endTime: '16:00', endsNextDay: false }],
      })
    ).body.data.id;
    const nightShift = (
      await post('admin', '/shifts', {
        code: 'NIGHT',
        nameAr: 'ليلية',
        segments: [{ startTime: '22:00', endTime: '06:00', endsNextDay: true }],
      })
    ).body.data.id;
    // الأحد..الخميس عمل (الجمعة والسبت راحة)
    const std = (
      await post('admin', '/work-schedules', {
        code: 'STD',
        nameAr: 'قياسي',
        days: week([0, 1, 2, 3, 4], dayShift),
      })
    ).body.data.id;
    const ngt = (
      await post('admin', '/work-schedules', {
        code: 'NGT',
        nameAr: 'ليلي',
        days: week([0, 1, 2, 3, 4], nightShift),
      })
    ).body.data.id;
    await post('admin', '/schedule-assignments', {
      scheduleId: std,
      scope: 'company',
      validFrom: '2026-01-01',
    });
    await post('admin', '/schedule-assignments', {
      scheduleId: ngt,
      scope: 'employee',
      scopeRef: empB,
      validFrom: '2026-01-01',
    });
    leaveType = (
      await admin
        .insertInto('leaveTypes')
        .values({ companyId: acme, code: 'ANN', nameAr: 'سنوية' })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  // الأحد 2026-09-06 .. الخميس 2026-09-10 أيام عمل، الجمعة 09-11 راحة
  it('بصمتان: حضور مع تأخير؛ والخروج المبكر خارج السماحية', async () => {
    expect((await punch('admin', empA, '2026-09-06', '08:25')).status).toBe(201);
    await punch('admin', empA, '2026-09-06', '16:00');
    const d = await dayOf(empA, '2026-09-06');
    expect(d).toMatchObject({
      status: 'present',
      lateMinutes: 25,
      earlyLeaveMinutes: 0,
      workedMinutes: 455,
    });
    await punch('admin', empA, '2026-09-07', '07:55');
    await punch('admin', empA, '2026-09-07', '15:30');
    expect(await dayOf(empA, '2026-09-07')).toMatchObject({
      status: 'present',
      lateMinutes: 0,
      earlyLeaveMinutes: 30,
    });
  });

  it('بصمة مكررة 409، وبصمة واحدة = ناقص، وبلا بصمات = غياب', async () => {
    const dup = await punch('admin', empA, '2026-09-06', '08:25');
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
    await punch('admin', empA, '2026-09-08', '08:00');
    expect((await dayOf(empA, '2026-09-08')).status).toBe('incomplete');
    // يوم عمل ماضٍ بلا بصمات
    await post('admin', '/attendance/recompute', {
      employeeId: empA,
      from: '2026-09-09',
      to: '2026-09-09',
    });
    expect((await dayOf(empA, '2026-09-09')).status).toBe('absent');
  });

  it('الإجازة المعتمدة تقلب الغياب إلى إجازة عبر إعادة الاحتساب، والعطلة والراحة', async () => {
    const lr = await admin
      .insertInto('leaveRequests')
      .values({
        companyId: acme,
        employeeId: empA,
        leaveTypeId: leaveType,
        startDate: '2026-09-09',
        endDate: '2026-09-09',
        days: 1,
        status: 'approved',
        createdBy: empUser,
      })
      .returning('id')
      .executeTakeFirstOrThrow();
    await admin
      .insertInto('leaveRequestDays')
      .values({
        companyId: acme,
        requestId: lr.id,
        dayDate: '2026-09-09',
        units: 1,
        kind: 'work',
      })
      .execute();
    await admin
      .insertInto('holidays')
      .values({ companyId: acme, holidayDate: '2026-09-10', nameAr: 'عطلة' })
      .execute();
    await post('admin', '/attendance/recompute', {
      employeeId: empA,
      from: '2026-09-09',
      to: '2026-09-11',
    });
    expect((await dayOf(empA, '2026-09-09')).status).toBe('leave');
    expect((await dayOf(empA, '2026-09-10')).status).toBe('holiday');
    expect((await dayOf(empA, '2026-09-11')).status).toBe('off');
  });

  it('وردية ليلية عبر منتصف الليل تُحتسب لليوم الذي بدأت فيه', async () => {
    await punch('admin', empB, '2026-09-06', '21:55');
    await punch('admin', empB, '2026-09-07', '06:00');
    const d = await dayOf(empB, '2026-09-06');
    expect(d).toMatchObject({ status: 'present', workedMinutes: 480, lateMinutes: 0 });
    // لا يظهر خروج الصباح كحضور لليوم التالي
    const next = await dayOf(empB, '2026-09-07');
    expect(next?.status).not.toBe('present');
  });

  it('اللصق الجماعي: مكرر ورقم وظيفي مجهول', async () => {
    const r = await post('admin', '/attendance/punches/bulk', {
      rows: [
        { employeeNo: empNo, date: '2026-09-06', time: '08:25' }, // مكرر
        { employeeNo: empNo, date: '2026-09-13', time: '08:00' },
        { employeeNo: 'NOPE', date: '2026-09-13', time: '08:00' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.inserted).toBe(1);
    expect(r.body.data.duplicates).toBe(1);
    expect(r.body.data.errors).toHaveLength(1);
    const list = await get(
      'admin',
      `/attendance/punches?employeeId=${empA}&from=2026-09-13&to=2026-09-13`,
    );
    expect(list.status).toBe(200);
  });

  it('التجاوز اليدوي يبقى بعد إعادة الاحتساب مع تنبيه إن تغيّر الحساب', async () => {
    const o = await post('admin', '/attendance/days/override', {
      employeeId: empA,
      date: '2026-09-08',
      status: 'present',
      note: 'نسي البصمة',
    });
    expect(o.status).toBe(200);
    expect(o.body.data).toMatchObject({ status: 'present', computedStatus: 'incomplete' });
    // يُكمل الخروج فيتغير الاحتساب إلى حضور → فرق عن الأساس
    await punch('admin', empA, '2026-09-08', '16:00');
    const d = await dayOf(empA, '2026-09-08');
    expect(d).toMatchObject({ status: 'present', isOverridden: true, diffWarning: true });
    const c = await post('admin', '/attendance/days/clear-override', {
      employeeId: empA,
      date: '2026-09-08',
    });
    expect(c.status).toBe(200);
    expect(await dayOf(empA, '2026-09-08')).toMatchObject({
      isOverridden: false,
      diffWarning: false,
      computedStatus: 'present',
    });
  });

  it('حذف البصمة اليدوية يعيد الاحتساب', async () => {
    const list = (
      await get('admin', `/attendance/punches?employeeId=${empA}&from=2026-09-08&to=2026-09-08`)
    ).body.data as Array<{ id: string }>;
    expect(list.length).toBe(2);
    const del = await request(api)
      .delete(`/api/v1/attendance/punches/${list[0]!.id}`)
      .set(as('admin'));
    expect(del.status).toBe(204);
    expect((await dayOf(empA, '2026-09-08')).status).toBe('incomplete');
  });

  it('اللوحة اليومية وأيامي والصلاحيات', async () => {
    const daily = await get('admin', '/attendance/daily?date=2026-09-06');
    expect(daily.status).toBe(200);
    expect(daily.body.data.counts.present).toBe(2);
    expect(daily.body.data.rows).toHaveLength(2);
    const me = await get('emp', '/attendance/days/me?from=2026-09-06&to=2026-09-07');
    expect(me.status).toBe(200);
    expect(me.body.data).toHaveLength(2);
    expect((await get('emp', '/attendance/daily?date=2026-09-06')).status).toBe(403);
    expect((await punch('emp', empA, '2026-09-20', '08:00')).status).toBe(403);
    expect(
      (await get('emp', `/attendance/days?employeeId=${empA}&from=2026-09-06&to=2026-09-07`))
        .status,
    ).toBe(403);
  });

  it('أيام المستقبل لا تُحتسب', async () => {
    const r = await post('admin', '/attendance/recompute', {
      employeeId: empA,
      from: '2099-01-01',
      to: '2099-01-05',
    });
    expect(r.status).toBe(200);
    expect(await days(empA, '2099-01-01', '2099-01-05')).toHaveLength(0);
  });
});
