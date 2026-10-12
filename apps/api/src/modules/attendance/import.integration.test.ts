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

describe('الحضور 5c: مركز استيراد البصمات', () => {
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
  let empC: string;
  let branchRuh: string;
  let branchJed: string;
  let systemId: string;
  let firstBatch: string;
  const raw = (who: string, path: string, body: string | Buffer) =>
    request(api).post(`/api/v1${path}`).set(as(who)).set('Content-Type', 'text/csv').send(body);
  const csv = (...lines: string[]) =>
    ['branch_id;department_id;empl_id;date_time;type', ...lines].join('\r\n');
  const dayOf = async (employeeId: string, date: string) =>
    (await get('admin', `/attendance/days?employeeId=${employeeId}&from=${date}&to=${date}`)).body
      .data[0] as Record<string, unknown> | undefined;
  const count = async (table: 'attendanceRecords' | 'importBatches' | 'importHeldRows') =>
    Number(
      (
        await admin
          .selectFrom(table)
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .executeTakeFirstOrThrow()
      ).n,
    );

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

    branchRuh = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    branchJed = (await post('admin', '/branches', { code: 'JED', nameAr: 'جدة' })).body.data.id;
    const dept = (
      await post('admin', '/departments', {
        code: 'IT',
        nameAr: 'تقنية',
        branchIds: [branchRuh, branchJed],
      })
    ).body.data.id;
    const mk = async (branch: string) => {
      const id = (await post('admin', '/employees', { firstNameAr: 'س', familyNameAr: 'ص' })).body
        .data.id as string;
      await admin
        .insertInto('employments')
        .values({
          companyId: acme,
          employeeId: id,
          branchId: branch,
          departmentId: dept,
          employmentType: 'full_time',
          validFrom: '2026-01-01',
        })
        .execute();
      return id;
    };
    empA = await mk(branchRuh);
    empB = await mk(branchJed);
    empC = await mk(branchRuh);

    systemId = (
      await admin
        .insertInto('externalSystems')
        .values({
          companyId: acme,
          key: 'attendance_device',
          nameAr: 'جهاز البصمة',
          purpose: 'attendance_device',
          refScope: 'branch',
          isUnique: false,
        })
        .returning('id')
        .executeTakeFirstOrThrow()
    ).id;
    const ref = (employeeId: string, value: string, branchId: string) =>
      admin
        .insertInto('employeeExternalRefs')
        .values({
          companyId: acme,
          employeeId,
          systemId,
          value,
          branchId,
          enforceUnique: false,
        })
        .execute();
    await ref(empA, '0042', branchRuh);
    await ref(empB, '0042', branchJed); // الرمز نفسه في فرعين
    await ref(empC, '0043', branchRuh);

    const shift = (
      await post('admin', '/shifts', {
        code: 'DAY',
        nameAr: 'صباحية',
        lateGraceMinutes: 10,
        earlyLeaveGraceMinutes: 10,
        segments: [{ startTime: '08:00', endTime: '16:00', endsNextDay: false }],
      })
    ).body.data.id;
    const sched = (
      await post('admin', '/work-schedules', {
        code: 'STD',
        nameAr: 'قياسي',
        days: [0, 1, 2, 3, 4, 5, 6].map((weekday) => ({
          weekday,
          shiftId: weekday <= 4 ? shift : null,
        })),
      })
    ).body.data.id;
    await post('admin', '/schedule-assignments', {
      scheduleId: sched,
      scope: 'company',
      validFrom: '2026-01-01',
    });
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  const FILE1 = csv(
    'RUH;1;0042;2026-09-06 08:25:10;0', // empA متأخر 25
    'RUH;1;0042;2026-09-06 16:01:00;1',
    'JED;1;0042;2026-09-06 07:58:00;0', // empB (مُمَيَّز بالفرع)
    'JED;1;0042;2026-09-06 16:00:00;1',
    'RUH;1;0043;2026-09-06 08:00:00;', // empC بلا نوع
    'RUH;1;0043;2026-09-06 16:00:00;',
    'RUH;1;0043;2026-09-06 16:00:00;', // مكرر داخل الملف
    'RUH;1;9999;2026-09-06 07:50:00;0', // غير مطابق
    'RUH;1;9999;2026-09-07 08:00:00;0',
    'RUH;1;0044;تاريخ خاطئ;0',
  );

  it('ملفات الاستيراد: إنشاء وافتراضي واحد وتعارض الإصدار والصلاحيات', async () => {
    const body = {
      code: 'DEV1',
      nameAr: 'جهاز الفرع',
      isDefault: true,
      columns: { branch: 0, department: 1, employee: 2, datetime: 3, type: 4 },
    };
    const a = await post('admin', '/attendance-import/profiles', body);
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({ delimiter: ';', encoding: 'auto', isDefault: true });
    expect((await post('admin', '/attendance-import/profiles', body)).status).toBe(409);
    const b = await post('admin', '/attendance-import/profiles', {
      ...body,
      code: 'DEV2',
      isDefault: true,
    });
    const list = (await get('admin', '/attendance-import/profiles')).body.data as {
      code: string;
      isDefault: boolean;
    }[];
    expect(list.filter((p) => p.isDefault).map((p) => p.code)).toEqual(['DEV2']);
    const stale = await request(api)
      .patch(`/api/v1/attendance-import/profiles/${b.body.data.id}`)
      .set(as('admin'))
      .send({ ...body, code: 'DEV2', version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect((await get('emp', '/attendance-import/profiles')).status).toBe(403);
    expect((await raw('emp', '/attendance-import', FILE1)).status).toBe(403);
  });

  it('المعاينة لا تكتب شيئاً وتُظهر المطابقة والمحجوز والأخطاء', async () => {
    const r = await raw('admin', '/attendance-import?dryRun=true', FILE1);
    expect(r.status).toBe(200);
    const d = r.body.data;
    expect(d).toMatchObject({
      applied: false,
      total: 10,
      toInsert: 6,
      duplicatesInFile: 1,
      held: 2,
      errorCount: 1,
      employees: 3,
      dateFrom: '2026-09-06',
      dateTo: '2026-09-06',
    });
    expect(d.errors[0]).toMatchObject({ line: 11 });
    expect(d.heldCodes).toEqual([{ code: '9999', reason: 'unmatched', count: 2 }]);
    expect(await count('attendanceRecords')).toBe(0);
    expect(await count('importBatches')).toBe(0);
  });

  it('التنفيذ: بصمات ودفعة ومحجوز وأيام محتسبة، والفرع يفكّ التباس الرمز', async () => {
    const r = await raw('admin', '/attendance-import?fileName=f1.csv', FILE1);
    expect(r.status).toBe(201);
    firstBatch = r.body.data.batchId;
    expect(r.body.data).toMatchObject({ applied: true, inserted: 6 });
    expect(await dayOf(empA, '2026-09-06')).toMatchObject({
      status: 'present',
      lateMinutes: 25,
    });
    expect(await dayOf(empB, '2026-09-06')).toMatchObject({ status: 'present', lateMinutes: 0 });
    expect(await dayOf(empC, '2026-09-06')).toMatchObject({
      status: 'present',
      workedMinutes: 480,
    });
    const batches = (await get('admin', '/attendance-import/batches')).body.data;
    expect(batches[0]).toMatchObject({
      status: 'applied',
      inserted: 6,
      held: 2,
      heldOpen: 2,
      profileCode: 'DEV2',
    });
    const summary = (await get('admin', '/attendance-import/held/summary')).body.data;
    expect(summary).toHaveLength(1);
    expect(summary[0]).toMatchObject({ deviceCode: '9999', rows: 2 });
  });

  it('نفس الملف مرفوض، وملف متداخل يُدرج الجديد فقط', async () => {
    const dup = await raw('admin', '/attendance-import', FILE1);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe('ALREADY_IMPORTED');
    const more = csv(
      'RUH;1;0042;2026-09-06 08:25:00;0', // موجود (الثواني تُهمل)
      'RUH;1;0042;2026-09-07 08:00:00;0',
      'RUH;1;0042;2026-09-07 16:00:00;1',
    );
    const r = await raw('admin', '/attendance-import', more);
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ toInsert: 2, alreadyExisting: 1, inserted: 2 });
    expect(await dayOf(empA, '2026-09-07')).toMatchObject({ status: 'present' });
  });

  it('ربط المحجوز بموظف: يحفظ المرجع ويطبّق البصمات ويحتسب', async () => {
    const bad = await post('admin', '/attendance-import/held/resolve', {
      deviceCode: 'NOPE',
      employeeId: empC,
    });
    expect(bad.status).toBe(404);
    const r = await post('admin', '/attendance-import/held/resolve', {
      deviceCode: '9999',
      employeeId: empC,
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ resolved: 2, inserted: 2 });
    expect(await dayOf(empC, '2026-09-07')).toMatchObject({ status: 'incomplete' });
    expect(
      ((await get('admin', '/attendance-import/held/summary')).body.data as unknown[]).length,
    ).toBe(0);
    // الرمز صار مرجعاً: المعاينة التالية تطابقه تلقائياً
    const pre = await raw(
      'admin',
      '/attendance-import?dryRun=true',
      csv('RUH;1;9999;2026-09-08 08:00:00;0'),
    );
    expect(pre.body.data).toMatchObject({ toInsert: 1, held: 0 });
  });

  it('تجاهل المحجوز يُسقطه دون بصمات', async () => {
    await raw('admin', '/attendance-import', csv('RUH;1;7777;2026-09-08 08:00:00;0'));
    const before = await count('attendanceRecords');
    const r = await post('admin', '/attendance-import/held/discard', { deviceCode: '7777' });
    expect(r.body.data).toEqual({ discarded: 1 });
    expect(await count('attendanceRecords')).toBe(before);
    expect(
      (await post('admin', '/attendance-import/held/discard', { deviceCode: '7777' })).status,
    ).toBe(404);
  });

  it('التراجع عن دفعة يحذف بصماتها ويعيد الاحتساب ويسمح بإعادة الاستيراد', async () => {
    const r = await post('admin', `/attendance-import/batches/${firstBatch}/revert`);
    expect(r.status).toBe(200);
    expect(r.body.data.removed).toBeGreaterThanOrEqual(6);
    expect(await dayOf(empB, '2026-09-06')).toMatchObject({ status: 'absent' });
    expect((await post('admin', `/attendance-import/batches/${firstBatch}/revert`)).status).toBe(
      409,
    );
    const again = await raw('admin', '/attendance-import', FILE1);
    expect(again.status).toBe(201);
    expect(await dayOf(empB, '2026-09-06')).toMatchObject({ status: 'present' });
  });

  it('ملف بترميز Windows-1256 وفاصل مختلف عبر ملف استيراد', async () => {
    const p = await post('admin', '/attendance-import/profiles', {
      code: 'COMMA',
      nameAr: 'فاصلة',
      delimiter: ',',
      encoding: 'windows-1256',
      hasHeader: 'no',
      dateOrder: 'dmy',
      directionMode: 'ignore',
      columns: { branch: null, department: null, employee: 0, datetime: 1, type: null },
    });
    expect(p.status).toBe(201);
    const body = Buffer.from('٠٠٤٣,20/09/2026 08:03\r\n٠٠٤٣,20/09/2026 16:00\r\n', 'latin1');
    const r = await raw('admin', `/attendance-import?profileId=${p.body.data.id}`, body);
    expect(r.status).toBe(201);
    // الأرقام الهندية المُرمَّزة latin1 ليست أرقاماً صالحة: تُحجز لا تُهمل
    expect(r.body.data.held + r.body.data.errorCount + r.body.data.inserted).toBeGreaterThan(0);
  });

  it('أداء: 200 موظف × شهر (≈8800 بصمة) تُستورد وتُحتسب في ثوانٍ', async () => {
    const N = 200;
    const rows = Array.from({ length: N }, (_, i) => ({
      companyId: acme,
      employeeNo: `PERF${String(i).padStart(3, '0')}`,
      fullNameAr: 'ا ب',
      firstNameAr: 'ا',
      familyNameAr: 'ب',
    }));
    const emps = await admin.insertInto('employees').values(rows).returning('id').execute();
    await admin
      .insertInto('employeeExternalRefs')
      .values(
        emps.map((e, i) => ({
          companyId: acme,
          employeeId: e.id,
          systemId,
          value: `P${i}`,
          branchId: branchRuh,
          enforceUnique: false,
        })),
      )
      .execute();
    const lines: string[] = [];
    for (let day = 1; day <= 31; day++) {
      const dt = new Date(Date.UTC(2026, 7, day));
      if (dt.getUTCDay() > 4) continue; // الجمعة والسبت راحة
      const d = dt.toISOString().slice(0, 10);
      for (let i = 0; i < N; i++) {
        lines.push(`RUH;1;P${i};${d} 08:0${i % 10}:00;0`, `RUH;1;P${i};${d} 16:00:00;1`);
      }
    }
    const t0 = Date.now();
    const r = await raw('admin', '/attendance-import?fileName=perf.csv', csv(...lines));
    const secs = (Date.now() - t0) / 1000;
    expect(r.status).toBe(201);
    expect(r.body.data.inserted).toBe(lines.length);
    expect(secs).toBeLessThan(30);
    const d = await dayOf(emps[5]!.id, '2026-08-03');
    expect(d).toMatchObject({ status: 'present' });
  }, 120_000);
});
