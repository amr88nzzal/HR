import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import writeXlsxFile from 'write-excel-file/node';
import { IMPORT_COLUMNS } from '@hrms/shared';
import { seedDefaultExternalSystems } from './external.routes.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('استيراد الموظفين من Excel', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

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
      return user.id;
    });
  const login = async (email: string, company?: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));

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
      await withTenant(admin, { companyId: row.id }, async (ctx) => {
        await seedDefaultRoles(ctx);
        await seedDefaultExternalSystems(ctx);
      });
      return row.id;
    };
    acme = await mk('acme');
    const globex = await mk('globex');
    const k = () => randomBytes(32).toString('base64');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto: createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() }),
      },
    });
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(acme, 'officer@acme.test', 'hr_officer');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    tokens['officer'] = await login('officer@acme.test');
    tokens['globex'] = await login('admin@globex.test', 'globex');

    ids['ruh'] = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data.id;
    ids['jed'] = (await post('admin', '/branches', { code: 'JED', nameAr: 'جدة' })).body.data.id;
    const systems = (await get('admin', '/external-systems')).body.data as {
      id: string;
      key: string;
    }[];
    for (const s of systems) ids[s.key] = s.id;
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  const HEAD = Object.fromEntries(IMPORT_COLUMNS.map((c) => [c.key, c.ar]));
  type RowIn = Record<string, string | number | Date | null>;
  const sheet = async (
    rows: RowIn[],
    keys?: string[],
    lang: 'ar' | 'en' = 'ar',
  ): Promise<Buffer> => {
    const cols = keys ?? [...new Set(rows.flatMap((r) => Object.keys(r)))];
    const label = (k: string) =>
      lang === 'ar' ? (HEAD[k] ?? k) : (IMPORT_COLUMNS.find((c) => c.key === k)?.en ?? k);
    const data = [
      cols.map((k) => ({ value: label(k), fontWeight: 'bold' as const })),
      ...rows.map((r) =>
        cols.map((k) => {
          const v = r[k];
          if (v === null || v === undefined) return null;
          if (v instanceof Date) return { value: v, format: 'yyyy-mm-dd' };
          return v;
        }),
      ),
    ];
    return writeXlsxFile(data as never).toBuffer();
  };
  const imp = (who: string, buf: Buffer | string, query = '') =>
    request(api)
      .post(`/api/v1/employee-import${query}`)
      .set(as(who))
      .set('Content-Type', 'application/octet-stream')
      .send(buf);
  const countEmployees = async () =>
    Number(
      (
        await admin
          .selectFrom('employees')
          .select((eb) => eb.fn.countAll<string>().as('n'))
          .where('companyId', '=', acme)
          .executeTakeFirstOrThrow()
      ).n,
    );

  beforeAll(async () => {
    ids['dept'] = (
      await post('admin', '/departments', {
        code: 'HR',
        nameAr: 'الموارد',
        branchIds: [ids['ruh']],
      })
    ).body.data.id;
    await post('admin', '/job-titles', { code: 'T1', nameAr: 'أخصائي' });
  });

  it('القالب يُحمَّل بترويسة قابلة للقراءة', async () => {
    const res = await request(api)
      .get('/api/v1/employee-import/template')
      .set(as('admin'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    const dry = await imp('admin', res.body as Buffer, '?dryRun=true');
    expect(dry.status).toBe(200);
    expect(dry.body.data.total).toBe(0);
  });

  it('التحقق (Dry Run) لا يحفظ شيئاً ولا يستهلك الترقيم', async () => {
    const before = await countEmployees();
    const buf = await sheet([
      {
        firstNameAr: 'سعد',
        familyNameAr: 'العتيبي',
        branchCode: 'RUH',
        departmentCode: 'HR',
        hireDate: new Date('2024-01-01T00:00:00Z'),
      },
      { firstNameAr: 'منى', familyNameAr: 'الحربي', gender: 'أنثى' },
    ]);
    const res = await imp('admin', buf, '?dryRun=true');
    expect(res.status).toBe(200);
    const r = res.body.data;
    expect(r).toMatchObject({ dryRun: true, total: 2, created: 2, failed: 0, committed: false });
    expect(await countEmployees()).toBe(before);
    // الترقيم لم يُستهلك: أول موظف فعلي يأخذ الرقم الأول
    const first = await post('admin', '/employees', {
      firstNameAr: 'تجربة',
      familyNameAr: 'ترقيم',
    });
    expect(first.body.data.employeeNo).toBe('EMP-00001');
    ids['firstEmp'] = first.body.data.id;
  });

  it('الاستيراد يُنشئ الموظفين مع التعيين والاتصال والمراجع بأصفارها البادئة', async () => {
    const buf = await sheet([
      {
        firstNameAr: 'سعد',
        fatherNameAr: 'محمد',
        familyNameAr: 'العتيبي',
        firstNameEn: 'Saad',
        familyNameEn: 'Otaibi',
        birthDate: new Date('1990-05-20T00:00:00Z'),
        gender: 'ذكر',
        maritalStatus: 'متزوج',
        nationality: 'sa',
        mobile: '0500000001',
        email: 'saad@example.com',
        branchCode: 'ruh',
        departmentCode: 'hr',
        jobTitleCode: 'T1',
        hireDate: '2024-02-01',
        employmentType: 'دوام كامل',
        accountingNo: '٠٠٧٧',
        deviceCode: '0012',
      },
      { firstNameAr: 'منى', familyNameAr: 'الحربي', gender: 'F', hireDate: null },
    ]);
    const res = await imp('admin', buf);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ created: 2, updated: 0, failed: 0, committed: true });
    const nos = res.body.data.rows.map((r: { employeeNo: string }) => r.employeeNo);
    expect(nos).toEqual(['EMP-00002', 'EMP-00003']);

    const list = (await get('admin', '/employees?q=العتيبي')).body.data as Record<
      string,
      unknown
    >[];
    expect(list).toHaveLength(1);
    const saad = list[0] as Record<string, unknown>;
    expect(saad).toMatchObject({
      nationality: 'SA',
      gender: 'male',
      maritalStatus: 'married',
      birthDate: '1990-05-20',
      status: 'active',
      firstHireDate: '2024-02-01',
    });
    expect(saad['currentBranchId']).toBe(ids['ruh']);
    expect(saad['currentDepartmentId']).toBe(ids['dept']);
    const refs = (await get('admin', `/employees/${saad['id']}/external-refs`)).body.data as {
      value: string;
      systemKey: string;
    }[];
    expect(refs.map((x) => `${x.systemKey}:${x.value}`).sort()).toEqual([
      'accounting:0077',
      'attendance_device:0012',
    ]);
    const contacts = (await get('admin', `/employees/${saad['id']}/contacts`)).body.data as {
      type: string;
      isPrimary: boolean;
    }[];
    expect(contacts.map((c) => c.type).sort()).toEqual(['email', 'mobile']);
    // المطابقة بالمرجع تعمل فوراً
    const hit = await get(
      'admin',
      `/external-refs/resolve?system=attendance_device&value=0012&branchId=${ids['ruh']}`,
    );
    expect(hit.body.data.employeeId).toBe(saad['id']);
    // منى بلا تعيين
    const mona = (await get('admin', '/employees?q=الحربي')).body.data[0];
    expect(mona.status).toBe('active');
    expect(mona.currentBranchId).toBeNull();
    // التدقيق
    const audit = await admin
      .selectFrom('auditLogs')
      .select('changes')
      .where('action', '=', 'import')
      .where('companyId', '=', acme)
      .execute();
    expect(audit).toHaveLength(1);
  });

  it('الأخطاء تُبلَّغ لكل صف، ولا يُحفظ شيء بدونها skipErrors، ومعه تُحفظ الصحيحة فقط', async () => {
    const before = await countEmployees();
    const rows: RowIn[] = [
      { firstNameAr: 'صحيح', familyNameAr: 'أول' },
      { firstNameAr: 'خطأ', familyNameAr: 'جنس', gender: 'غير معروف' },
      {
        firstNameAr: 'خطأ',
        familyNameAr: 'فرع',
        branchCode: 'NOPE',
        departmentCode: 'HR',
        hireDate: '2024-01-01',
      },
      { firstNameAr: 'خطأ', familyNameAr: 'تعيين', branchCode: 'RUH' },
      { firstNameAr: 'خطأ', familyNameAr: 'تاريخ', birthDate: '20/05/1990' },
      { firstNameAr: 'خطأ', familyNameAr: 'بريد', email: 'not-an-email' },
      { firstNameAr: 'صحيح', familyNameAr: 'ثان' },
    ];
    const buf = await sheet(rows);
    const dry = await imp('admin', buf, '?dryRun=true');
    expect(dry.body.data).toMatchObject({ created: 2, failed: 5 });
    const msgs = (dry.body.data.rows as { row: number; errors: string[] }[]).filter(
      (r) => r.errors.length,
    );
    expect(msgs.map((m) => m.row)).toEqual([3, 4, 5, 6, 7]);
    expect(msgs[0]?.errors[0]).toContain('الجنس');
    expect(msgs[1]?.errors.join()).toContain('NOPE');
    expect(msgs[2]?.errors.join()).toContain('معاً');

    const strict = await imp('admin', buf);
    expect(strict.status).toBe(200);
    expect(strict.body.data.committed).toBe(false);
    expect(await countEmployees()).toBe(before);

    const skip = await imp('admin', buf, '?skipErrors=true');
    expect(skip.body.data).toMatchObject({ committed: true, created: 2, failed: 5 });
    expect(await countEmployees()).toBe(before + 2);
  });

  it('التحديث بالرقم الوظيفي: يغيّر المذكور فقط ويعيّن إن لم يكن معيّناً ويتجاهل التعيين لمعيَّن', async () => {
    const mona = (await get('admin', '/employees?q=الحربي')).body.data[0];
    const monaNo = mona.employeeNo as string;
    const saad = (await get('admin', '/employees?q=العتيبي')).body.data[0];
    const res = await imp(
      'admin',
      await sheet([
        {
          employeeNo: monaNo,
          familyNameAr: 'الحربي الجديد',
          branchCode: 'RUH',
          departmentCode: 'HR',
          hireDate: '2024-03-01',
          accountingNo: '9001',
        },
        {
          employeeNo: saad.employeeNo,
          branchCode: 'RUH',
          departmentCode: 'HR',
          hireDate: '2024-04-01',
          mobile: '0500000002',
        },
        { employeeNo: 'EMP-99999', firstNameAr: 'جديد', familyNameAr: 'بالرقم' },
      ]),
      '?dryRun=false',
    );
    expect(res.status).toBe(200);
    const [a, b, c] = res.body.data.rows;
    expect(a).toMatchObject({ action: 'update', employeeNo: monaNo });
    expect(b.action).toBe('update');
    expect(b.warnings.join()).toContain('تُجوهلت');
    expect(c).toMatchObject({ action: 'create', employeeNo: 'EMP-99999' });
    const after = (await get('admin', `/employees/${mona.id}`)).body.data;
    expect(after.familyNameAr).toBe('الحربي الجديد');
    expect(after.firstNameAr).toBe('منى');
    expect(after.fullNameAr).toBe('منى الحربي الجديد');
    expect(after.version).toBeGreaterThan(mona.version);
    const emps = (await get('admin', `/employees/${mona.id}/employments`)).body.data;
    expect(emps).toHaveLength(1);
    const contacts = (await get('admin', `/employees/${saad.id}/contacts`)).body.data as {
      type: string;
      isPrimary: boolean;
    }[];
    expect(contacts.filter((x) => x.type === 'mobile')).toHaveLength(2);
    expect(contacts.filter((x) => x.type === 'mobile' && x.isPrimary)).toHaveLength(1);
  });

  it('رقم وظيفي مكرر في الملف وتكرار رقم محاسبة بين صفين يُرفضان', async () => {
    const res = await imp(
      'admin',
      await sheet([
        { employeeNo: 'DUP-1', firstNameAr: 'أ', familyNameAr: 'أ' },
        { employeeNo: 'DUP-1', firstNameAr: 'ب', familyNameAr: 'ب' },
        { firstNameAr: 'ج', familyNameAr: 'ج', accountingNo: '5555' },
        { firstNameAr: 'د', familyNameAr: 'د', accountingNo: '5555' },
      ]),
      '?dryRun=true',
    );
    const rows = res.body.data.rows as { errors: string[] }[];
    expect(rows[0]?.errors[0]).toContain('مكرر في الملف');
    expect(rows[1]?.errors[0]).toContain('مكرر في الملف');
    expect(rows[2]?.errors).toEqual([]);
    expect(rows[3]?.errors[0]).toContain('تعارض');
    // رقم محاسبة موجود لموظف آخر
    const clash = await imp(
      'admin',
      await sheet([{ firstNameAr: 'هـ', familyNameAr: 'هـ', accountingNo: '0077' }]),
      '?dryRun=true',
    );
    expect(clash.body.data.rows[0].errors[0]).toMatch(/تعارض|مستخدمة/);
  });

  it('ترويسة بالإنجليزية، وخلية رقمية للأكواد، وأعمدة مجهولة تُبلَّغ', async () => {
    const res = await imp(
      'admin',
      await sheet(
        [{ firstNameAr: 'إنجليزي', familyNameAr: 'ترويسة', accountingNo: 4321, zzz: 'x' }],
        undefined,
        'en',
      ),
      '?dryRun=true',
    );
    expect(res.body.data.failed).toBe(0);
    expect(res.body.data.unknownColumns).toEqual(['zzz']);
  });

  it('ملف غير صالح، أعمدة مطلوبة ناقصة، وصلاحية ونطاق', async () => {
    expect((await imp('admin', Buffer.from('not an excel file'))).status).toBe(400);
    const missing = await imp('admin', await sheet([{ mobile: '1' }]));
    expect(missing.status).toBe(400);
    expect(missing.body.error.message).toContain('الاسم الأول');
    expect((await request(api).post('/api/v1/employee-import').set(as('admin'))).status).toBe(400);
    expect(
      (await imp('officer', await sheet([{ firstNameAr: 'أ', familyNameAr: 'ب' }]))).status,
    ).toBe(403);
    expect(
      (await request(api).get('/api/v1/employee-import/template').set(as('officer'))).status,
    ).toBe(403);
    expect(
      (await imp('globex', await sheet([{ firstNameAr: 'أ', familyNameAr: 'ب' }]), '?dryRun=true'))
        .status,
    ).toBe(200);
  });

  it('استيراد 300 موظف بتعيين ومراجع يكتمل في زمن معقول', async () => {
    const rows = Array.from({ length: 300 }, (_, i) => ({
      firstNameAr: `موظف${i}`,
      familyNameAr: 'دفعة',
      mobile: `05${String(10000000 + i)}`,
      branchCode: 'RUH',
      departmentCode: 'HR',
      hireDate: '2024-01-01',
      accountingNo: `B${i}`,
    }));
    const started = Date.now();
    const res = await imp('admin', await sheet(rows));
    const ms = Date.now() - started;
    console.info(`import 300 rows: ${ms}ms`);
    expect(res.body.data).toMatchObject({ created: 300, failed: 0, committed: true });
    expect(ms).toBeLessThan(30_000);
  });

  it('الحد الأقصى للصفوف', async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => ({
      firstNameAr: `م${i}`,
      familyNameAr: 'ك',
    }));
    const res = await imp('admin', await sheet(rows), '?dryRun=true');
    expect(res.status).toBe(413);
    expect(res.body.error.code).toBe('IMPORT_TOO_LARGE');
  });
});
