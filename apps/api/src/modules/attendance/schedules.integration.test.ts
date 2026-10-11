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

describe('الحضور 5a: الورديات والجداول وتعيينها', () => {
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

  let day: string;
  let split: string;
  let night: string;
  let empA: string;
  let empB: string;
  let deptA: string;
  let schedStd: string;
  let schedNight: string;

  const seg = (startTime: string, endTime: string, endsNextDay = false) => ({
    startTime,
    endTime,
    endsNextDay,
  });
  const week = (work: number[], shiftId: string) =>
    [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
      weekday,
      shiftId: work.includes(weekday) ? shiftId : null,
    }));
  const resolve = async (employeeId: string, date: string) =>
    (await get('admin', `/schedule-assignments/resolve?employeeId=${employeeId}&date=${date}`)).body
      .data;

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
    await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');

    const branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data
      .id;
    deptA = (
      await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
    ).body.data.id;
    const mk = async () =>
      (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body.data
        .id as string;
    empA = await mk();
    empB = await mk();
    await admin
      .insertInto('employments')
      .values({
        companyId: acme,
        employeeId: empA,
        branchId: branch,
        departmentId: deptA,
        employmentType: 'full_time',
        validFrom: '2026-01-01',
      })
      .execute();
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('الورديات: عادية ومقسومة وليلية بفتراتها', async () => {
    const d = await post('admin', '/shifts', {
      code: 'DAY',
      nameAr: 'صباحية',
      lateGraceMinutes: 10,
      segments: [seg('08:00', '16:00')],
    });
    expect(d.status).toBe(201);
    day = d.body.data.id;
    expect(d.body.data.segments).toEqual([
      { position: 1, startTime: '08:00', endTime: '16:00', endsNextDay: false },
    ]);
    const s = await post('admin', '/shifts', {
      code: 'SPLIT',
      nameAr: 'مقسومة',
      segments: [seg('08:00', '12:00'), seg('16:00', '20:00')],
    });
    expect(s.status).toBe(201);
    split = s.body.data.id;
    const n = await post('admin', '/shifts', {
      code: 'NIGHT',
      nameAr: 'ليلية',
      segments: [seg('22:00', '06:00', true)],
    });
    expect(n.status).toBe(201);
    night = n.body.data.id;
    const list = await get('admin', '/shifts');
    expect(list.body.data.map((x: { code: string }) => x.code)).toEqual(['DAY', 'NIGHT', 'SPLIT']);
  });

  it('التحقق: تداخل الفترات ونهاية قبل البداية ورمز مكرر', async () => {
    const overlap = await post('admin', '/shifts', {
      code: 'BAD1',
      nameAr: 'x',
      segments: [seg('08:00', '12:00'), seg('11:00', '14:00')],
    });
    expect(overlap.status).toBe(400);
    const backwards = await post('admin', '/shifts', {
      code: 'BAD2',
      nameAr: 'x',
      segments: [seg('16:00', '08:00')],
    });
    expect(backwards.status).toBe(400);
    const dup = await post('admin', '/shifts', {
      code: 'DAY',
      nameAr: 'x',
      segments: [seg('09:00', '17:00')],
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('DUPLICATE');
  });

  it('تعديل الوردية بالإصدار: يستبدل الفترات ويرفض الإصدار القديم', async () => {
    const cur = (await get('admin', `/shifts/${day}`)).body.data;
    const ok = await request(api)
      .patch(`/api/v1/shifts/${day}`)
      .set(as('admin'))
      .send({
        code: 'DAY',
        nameAr: 'صباحية',
        lateGraceMinutes: 15,
        segments: [seg('07:30', '15:30')],
        version: cur.version,
      });
    expect(ok.status).toBe(200);
    expect(ok.body.data.segments[0].startTime).toBe('07:30');
    expect(ok.body.data.version).toBe(cur.version + 1);
    const stale = await request(api)
      .patch(`/api/v1/shifts/${day}`)
      .set(as('admin'))
      .send({ code: 'DAY', nameAr: 'x', segments: [seg('08:00', '16:00')], version: cur.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('الجدول الأسبوعي: سبعة أيام بالضبط (الجمعة والسبت راحة)', async () => {
    const bad = await post('admin', '/work-schedules', {
      code: 'BAD',
      nameAr: 'x',
      days: week([0, 1], day).slice(0, 5),
    });
    expect(bad.status).toBe(400);
    const r = await post('admin', '/work-schedules', {
      code: 'STD',
      nameAr: 'قياسي',
      days: week([0, 1, 2, 3, 4], day),
    });
    expect(r.status).toBe(201);
    schedStd = r.body.data.id;
    expect(r.body.data.days).toHaveLength(7);
    const n = await post('admin', '/work-schedules', {
      code: 'NIGHT',
      nameAr: 'ليلي',
      days: week([0, 1, 2, 3, 4], night),
    });
    schedNight = n.body.data.id;
    const unknown = await post('admin', '/work-schedules', {
      code: 'GHOST',
      nameAr: 'x',
      days: week([0], '00000000-0000-4000-8000-000000000000'),
    });
    expect(unknown.status).toBe(400); // وردية غير موجودة
  });

  it('لا حذف لوردية أو جدول مستخدم', async () => {
    const d1 = await request(api).delete(`/api/v1/shifts/${day}`).set(as('admin'));
    expect(d1.status).toBe(409);
    expect(d1.body.error.code).toBe('IN_USE');
    const free = (
      await post('admin', '/shifts', {
        code: 'TMP',
        nameAr: 'x',
        segments: [seg('09:00', '10:00')],
      })
    ).body.data.id;
    expect((await request(api).delete(`/api/v1/shifts/${free}`).set(as('admin'))).status).toBe(204);
  });

  it('بلا تعيين لا جدول؛ تعيين الشركة يسري على الجميع', async () => {
    expect(await resolve(empA, '2026-10-12')).toBeNull();
    const a = await post('admin', '/schedule-assignments', {
      scheduleId: schedStd,
      scope: 'company',
      validFrom: '2026-01-01',
    });
    expect(a.status).toBe(201);
    // الاثنين 2026-10-12 يوم عمل؛ الجمعة 2026-10-16 راحة
    const mon = await resolve(empB, '2026-10-12');
    expect(mon).toMatchObject({ scheduleCode: 'STD', scope: 'company' });
    expect(mon.shift.code).toBe('DAY');
    const fri = await resolve(empB, '2026-10-16');
    expect(fri).toMatchObject({ scheduleCode: 'STD', shift: null });
  });

  it('الأخص يغلب: القسم ثم الموظف، وفترة الصلاحية تنتهي', async () => {
    await post('admin', '/schedule-assignments', {
      scheduleId: schedNight,
      scope: 'department',
      scopeRef: deptA,
      validFrom: '2026-01-01',
    });
    expect((await resolve(empA, '2026-10-12')).scheduleCode).toBe('NIGHT');
    expect((await resolve(empB, '2026-10-12')).scheduleCode).toBe('STD'); // خارج القسم
    // تجاوز مؤقت للموظف بوردية مقسومة لمدة أسبوعين
    const temp = (
      await post('admin', '/work-schedules', {
        code: 'TEMP',
        nameAr: 'مؤقت',
        days: week([0, 1, 2, 3, 4], split),
      })
    ).body.data.id;
    const a = await post('admin', '/schedule-assignments', {
      scheduleId: temp,
      scope: 'employee',
      scopeRef: empA,
      validFrom: '2026-10-11',
      validTo: '2026-10-24',
    });
    expect(a.status).toBe(201);
    const inside = await resolve(empA, '2026-10-12');
    expect(inside.scheduleCode).toBe('TEMP');
    expect(inside.shift.segments).toHaveLength(2);
    expect((await resolve(empA, '2026-10-25')).scheduleCode).toBe('NIGHT'); // عاد لجدول القسم
  });

  it('التعيين المكرر 409، والنطاق يتطلب مرجعاً، والحذف', async () => {
    const dup = await post('admin', '/schedule-assignments', {
      scheduleId: schedStd,
      scope: 'company',
      validFrom: '2026-01-01',
    });
    expect(dup.status).toBe(409);
    const noRef = await post('admin', '/schedule-assignments', {
      scheduleId: schedStd,
      scope: 'department',
      validFrom: '2026-01-01',
    });
    expect(noRef.status).toBe(400);
    const list = await get('admin', `/schedule-assignments?scheduleId=${schedStd}`);
    expect(list.body.data).toHaveLength(1);
    const del = await request(api)
      .delete(`/api/v1/schedule-assignments/${list.body.data[0].id}`)
      .set(as('admin'));
    expect(del.status).toBe(204);
  });

  it('الصلاحيات: الموظف لا يقرأ الجداول ولا ينشئ', async () => {
    expect((await get('emp', '/shifts')).status).toBe(403);
    expect(
      (await post('emp', '/shifts', { code: 'X', nameAr: 'x', segments: [seg('09:00', '10:00')] }))
        .status,
    ).toBe(403);
  });
});
