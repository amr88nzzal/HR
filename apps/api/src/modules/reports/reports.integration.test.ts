import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import { sql } from 'kysely';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { reportJobs } from './jobs.js';
import { createLocalStorage } from '../../shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const testStorage = createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-reports-')));
const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('المرحلة 8: التقارير ولوحة المعلومات', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const rendered: string[] = [];
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
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: testStorage,
        render: async (html: string) => {
          rendered.push(html);
          return Buffer.from('%PDF-1.4 fake payslip');
        },
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    await makeUser('emp@acme.test', 'employee');
    await makeUser('other@acme.test', 'employee');
    for (const who of ['admin', 'hr', 'emp', 'other'])
      tokens[who] = await login(`${who}@acme.test`);
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
    const empUser = await admin
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'emp@acme.test')
      .executeTakeFirstOrThrow();
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx.updateTable('employees').set({ userId: empUser.id }).where('id', '=', a).execute(),
    );
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

  let jan: string;
  const text = (r: { body: unknown; text?: string }) => (r.text ?? String(r.body)) as string;
  const buf = (path: string, who: string) =>
    request(api)
      .get(`/api/v1${path}`)
      .set(as(who))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });

  it('الفهرس يتبع الصلاحيات: HR يرى تقارير الموظفين لا الرواتب، والموظف العادي لا يصل إلا لما يملك صلاحيته', async () => {
    const adm = (await get('admin', '/reports')).body.data as { code: string }[];
    expect(adm.map((r) => r.code)).toEqual(
      expect.arrayContaining(['employees.roster', 'payroll.summary', 'payroll.overrides']),
    );
    const hr = (await get('hr', '/reports')).body.data as { code: string }[];
    expect(hr.some((r) => r.code === 'employees.roster')).toBe(true);
    expect(hr.some((r) => r.code.startsWith('payroll.'))).toBe(false);
    expect((await get('hr', '/reports/payroll.summary')).status).toBe(404);
    expect((await get('hr', '/reports/payroll.summary/run')).status).toBe(404);
    // دور الموظف يقرأ الموظفين (بنطاق إسناده): ولا يصل لتقارير غيرها
    const own = await get('emp', '/reports/employees.roster/run');
    expect(own.status).toBe(200);
    expect(own.body.meta.total).toBe(1);
  });

  it('العمود المقيَّد بصلاحية يُحجب كلياً: الراتب الأساسي للمدير فقط', async () => {
    const admin1 = await get('admin', '/reports/employees.roster/run?columns=nameAr,basicSalary');
    expect(admin1.status, JSON.stringify(admin1.body)).toBe(200);
    expect(admin1.body.meta.columns.map((c: { key: string }) => c.key)).toEqual([
      'nameAr',
      'basicSalary',
    ]);
    expect(admin1.body.data[0].basicSalary).toBe('3000.00');
    const hr1 = await get('hr', '/reports/employees.roster/run?columns=nameAr,basicSalary');
    expect(hr1.body.meta.columns.map((c: { key: string }) => c.key)).toEqual(['nameAr']);
    expect(JSON.stringify(hr1.body)).not.toContain('3000');
    expect((await get('hr', '/reports/employees.roster/run?columns=basicSalary')).status).toBe(400);
    const man = (await get('hr', '/reports/employees.roster')).body.data.manifest;
    expect(man.columns.some((c: { key: string }) => c.key === 'basicSalary')).toBe(false);
  });

  it('المرشحات تُتحقق (400) والمجهولة تُهمل', async () => {
    expect((await get('admin', '/reports/payroll.summary/run?year=abc')).status).toBe(400);
    expect((await get('admin', '/reports/employees.roster/run?status=nope')).status).toBe(400);
    expect((await get('admin', '/reports/employees.roster/run?evil=1')).status).toBe(200);
    const none = await get('admin', '/reports/employees.roster/run?status=terminated');
    expect(none.body.meta.total).toBe(0);
  });

  it('تصدير CSV وXLSX مباشرة وسجل التشغيل', async () => {
    const csv = await get('admin', '/reports/employees.roster/export?format=csv&lang=en');
    expect(csv.status, JSON.stringify(csv.body)).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toMatch(/employees\.roster-\d{4}-\d{2}-\d{2}\.csv/);
    expect(text(csv)).toContain('Employee No.');
    expect(text(csv)).toContain('أحمد');
    const x = await buf('/reports/employees.roster/export?format=xlsx', 'admin');
    expect(x.status).toBe(200);
    expect((x.body as Buffer).subarray(0, 2).toString()).toBe('PK');
    const runs = (await get('admin', '/reports/runs')).body.data as {
      format: string;
      mode: string;
    }[];
    expect(runs.map((r) => r.format)).toEqual(expect.arrayContaining(['csv', 'xlsx']));
    expect(runs.every((r) => r.mode === 'direct')).toBe(true);
    expect(((await get('hr', '/reports/runs')).body.data as unknown[]).length).toBe(0);
  });

  it('HTML وPDF بالترويسة، وPDF عبر حاوية render', async () => {
    const html = await get('admin', '/reports/employees.roster/export?format=html');
    expect(html.status).toBe(200);
    expect(html.headers['content-type']).toContain('text/html');
    expect(text(html)).toContain('قائمة الموظفين');
    const before = rendered.length;
    const pdf = await buf('/reports/employees.roster/export?format=pdf', 'admin');
    expect(pdf.status).toBe(200);
    expect(rendered.length).toBe(before + 1);
    expect(rendered.at(-1)).toContain('أحمد');
  });

  it('التصدير الكبير كمهمة: 503 بلا طابور، وصيغة غير مدعومة 400', async () => {
    const r = await request(api)
      .post('/api/v1/reports/employees.roster/export-jobs')
      .set(as('admin'))
      .send({ format: 'csv' });
    expect(r.status).toBe(503);
    expect((await get('admin', '/reports/employees.roster/export?format=docx')).status).toBe(400);
  });

  it('مهمة التصدير الكبير: تكتب الملف وتسجّل التشغيل ويُنزَّل بصاحبه فقط، والتنظيف يحذفه عند الانتهاء', async () => {
    const adminUser = await admin
      .selectFrom('users')
      .select('id')
      .where('email', '=', 'admin@acme.test')
      .executeTakeFirstOrThrow();
    const [exportJob, cleanupJob] = reportJobs(
      { storage: testStorage, crypto: undefined },
      'https://hr.example.com',
    );
    const queue = { enqueue: async () => 'x' } as never;
    const info = { runId: 'r', attempt: 1, maxAttempts: 3, queue };
    const runId = await withTenant(admin, { companyId: acme }, async (ctx) => {
      const { rows } = await sql<{ id: string }>`
        insert into report_runs (company_id, user_id, report_code, format, mode, columns, lang, status)
        values (${acme}, ${adminUser.id}, 'employees.roster', 'csv', 'job', '["employeeNo","nameAr"]'::jsonb, 'ar', 'queued')
        returning id`.execute(ctx.trx);
      await exportJob!.handle(ctx, { runId: rows[0]!.id }, info);
      return rows[0]!.id;
    });
    const runs = (await get('admin', '/reports/runs')).body.data as Record<string, unknown>[];
    const mine = runs.find((r) => r['id'] === runId)!;
    expect(mine).toMatchObject({ status: 'done', mode: 'job', downloadable: true });
    expect(Number(mine['rowCount'])).toBe(1);
    const dl = await get('admin', `/reports/runs/${runId}/download`);
    expect(dl.status).toBe(200);
    expect(text(dl)).toContain('أحمد');
    expect((await get('hr', `/reports/runs/${runId}/download`)).status).toBe(404);
    await withTenant(admin, { companyId: acme }, async (ctx) => {
      await sql`update report_runs set expires_at = now() - interval '1 hour' where id = ${runId}`.execute(
        ctx.trx,
      );
      await cleanupJob!.handle(ctx, {}, info);
    });
    expect((await get('admin', `/reports/runs/${runId}/download`)).status).toBe(410);
  });

  it('تخطيط الأعمدة المحفوظ: إنشاء وتحديث وحذف، ويُنقّى من الأعمدة غير المسموحة', async () => {
    const mk = async (who: string, cols: string[], isDefault = false) =>
      post(who, '/reports/employees.roster/layouts', { name: 'عرضي', columns: cols, isDefault });
    const a1 = await mk('hr', ['nameAr', 'basicSalary', 'department'], true);
    expect(a1.status, JSON.stringify(a1.body)).toBe(201);
    expect(a1.body.data.columns).toEqual(['nameAr', 'department']);
    const a2 = await mk('hr', ['nameAr']);
    expect(a2.body.data.id).toBe(a1.body.data.id);
    const list = (await get('hr', '/reports/employees.roster')).body.data.layouts;
    expect(list).toHaveLength(1);
    expect((await get('admin', '/reports/employees.roster')).body.data.layouts).toHaveLength(0);
    expect(
      (await request(api).delete(`/api/v1/reports/layouts/${a1.body.data.id}`).set(as('admin')))
        .status,
    ).toBe(404);
    expect(
      (await request(api).delete(`/api/v1/reports/layouts/${a1.body.data.id}`).set(as('hr')))
        .status,
    ).toBe(204);
  });

  it('تقارير الرواتب بعد القفل: الملخص بالعملة والتجاوزات والسلف', async () => {
    jan = (await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })).body
      .data.id as string;
    await post('admin', `/payroll/periods/${jan}/calculate`);
    await post('admin', `/payroll/periods/${jan}/approve`);
    await post('admin', `/payroll/periods/${jan}/lock`);
    const s = await get('admin', '/reports/payroll.summary/run?year=2026');
    expect(s.status, JSON.stringify(s.body)).toBe(200);
    expect(s.body.data).toHaveLength(1);
    expect(s.body.data[0]).toMatchObject({
      period: '2026-01',
      currency: 'SAR',
      status: 'locked',
      net: '3150.00',
    });
    expect((await get('admin', '/reports/payroll.overrides/run')).status).toBe(200);
    expect((await get('admin', '/reports/payroll.loans/run')).status).toBe(200);
    const csv = await get('admin', '/reports/payroll.summary/export?format=csv');
    expect(text(csv)).toContain('3150.00');
  });

  it('لوحة المعلومات: أقسام حسب الصلاحية', async () => {
    const adm = (await get('admin', '/dashboard/summary')).body.data;
    expect(adm.me.employeeLinked).toBe(false);
    expect(adm.org.headcount.active).toBe(1);
    expect(adm.payroll.latestPeriod).toMatchObject({ year: 2026, month: 1, status: 'locked' });
    expect(adm.payroll.pendingPayments).toBeTruthy();
    const emp = (await get('emp', '/dashboard/summary')).body.data;
    expect(emp.me.employeeLinked).toBe(true);
    expect(emp.me.latestPayslip).toMatchObject({ year: 2026, month: 1 });
    expect(emp.org.leave).toBeUndefined();
    expect(emp.org.attendance).toBeUndefined();
    expect(emp.payroll).toBeUndefined();
    const hr = (await get('hr', '/dashboard/summary')).body.data;
    expect(hr.org.headcount).toBeTruthy();
    expect(hr.payroll).toBeUndefined();
    expect((await request(api).get('/api/v1/dashboard/summary')).status).toBe(401);
  });
});
