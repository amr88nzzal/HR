import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import PizZip from 'pizzip';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { createLocalStorage } from '../../shared/storage.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('الرواتب 7d: قسيمة PDF وبوابة الموظف والمقارنة', () => {
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
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-payslip-'))),
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
  let feb: string;
  const mkPeriod = async (month: number) =>
    (await post('admin', '/payroll/periods', { year: 2026, month, currency: 'SAR' })).body.data
      .id as string;
  const mine = async () => (await get('emp', '/me/payslips')).body.data as Record<string, string>[];

  it('لا قسيمة للموظف قبل قفل الدورة (حتى بعد الاعتماد)', async () => {
    jan = await mkPeriod(1);
    expect((await post('admin', `/payroll/periods/${jan}/calculate`)).status).toBe(200);
    expect(await mine()).toHaveLength(0);
    expect((await post('admin', `/payroll/periods/${jan}/approve`)).status).toBe(200);
    expect(await mine()).toHaveLength(0);
  });

  it('القفل ينشر القسيمة ويُشعر الموظف', async () => {
    expect((await post('admin', `/payroll/periods/${jan}/lock`)).status).toBe(200);
    const list = await mine();
    expect(list).toHaveLength(1);
    expect(Number(list[0]!['net'])).toBe(3150);
    const notes = (await get('emp', '/notifications')).body.data as { eventKey: string }[];
    expect(notes.some((n) => n.eventKey === 'payroll.payslip_ready')).toBe(true);
  });

  it('تفاصيل القسيمة بلا بنود صاحب العمل، والـ PDF بالترويسة ويُولَّد عند الطلب', async () => {
    const id = (await mine())[0]!['id'];
    const det = (await get('emp', `/me/payslips/${id}`)).body.data;
    expect(det.earnings.length).toBeGreaterThan(0);
    const pdf = await get('emp', `/me/payslips/${id}/pdf`);
    expect(pdf.status, JSON.stringify(pdf.body)).toBe(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['cache-control']).toContain('no-store');
    const html = rendered.at(-1)!;
    expect(html).toContain('أحمد');
    expect(html).toContain('3150.00');
  });

  it('العزل: مستخدم غير مرتبط بموظف 409، والـ PDF الإداري بصلاحية الرواتب فقط', async () => {
    expect((await get('other', '/me/payslips')).status).toBe(409);
    const id = (await mine())[0]!['id'];
    expect((await get('other', `/me/payslips/${id}/pdf`)).status).toBe(409);
    expect((await get('admin', `/payroll/payslips/${id}/pdf`)).status).toBe(200);
    expect((await get('hr', `/payroll/payslips/${id}/pdf`)).status).toBe(403);
    expect((await get('emp', `/payroll/payslips/${id}/pdf`)).status).toBe(403);
  });

  it('دورة غير مقفلة: القسيمة غير متاحة للموظف (404) لكنها متاحة لـ HR', async () => {
    feb = await mkPeriod(2);
    expect((await post('admin', `/payroll/periods/${feb}/calculate`)).status).toBe(200);
    const slips = (await get('admin', `/payroll/periods/${feb}/payslips`)).body.data as {
      id: string;
    }[];
    expect((await get('emp', `/me/payslips/${slips[0]!.id}`)).status).toBe(404);
    expect((await get('emp', `/me/payslips/${slips[0]!.id}/pdf`)).status).toBe(404);
    expect((await get('admin', `/payroll/payslips/${slips[0]!.id}/pdf`)).status).toBe(200);
  });

  it('ZIP الدورة لـ HR يحوي ملف PDF لكل قسيمة', async () => {
    const r = await request(api)
      .get(`/api/v1/payroll/periods/${jan}/payslips.zip`)
      .set(as('admin'))
      .buffer(true)
      .parse((res, cb) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(r.status).toBe(200);
    const names = Object.keys(new PizZip(r.body as Buffer).files);
    expect(names).toHaveLength(1);
    expect(names[0]).toMatch(/^payslip-.*-2026-01\.pdf$/);
    expect((await get('emp', `/payroll/periods/${jan}/payslips.zip`)).status).toBe(403);
  });

  it('المقارنة: فروق البنود والنسبة', async () => {
    const base = (await get('admin', `/payroll/periods/${feb}/compare`)).body.data;
    expect(base.previousPeriodId).toBe(jan);
    expect(base.rows).toHaveLength(0);
    const sal = await post('admin', `/employees/${a}/salaries`, {
      currency: 'SAR',
      basicAmount: '3500',
      validFrom: '2026-02-01',
      components: ['housing', 'social'].map((k) => ({ componentId: ids[k] })),
    });
    expect(sal.status, JSON.stringify(sal.body)).toBe(201);
    await post('admin', `/payroll/periods/${feb}/calculate`);
    const cmp = (await get('admin', `/payroll/periods/${feb}/compare`)).body.data;
    expect(cmp.rows).toHaveLength(1);
    const row = cmp.rows[0];
    expect(Number(row.diff)).toBeGreaterThan(0);
    expect(Number(row.pct)).toBeGreaterThan(0);
    expect(row.lines.some((l: Record<string, string>) => Number(l['diff']) === 500)).toBe(true);
    expect(row).toHaveProperty('loans');
  });
});
