import { randomBytes } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { createLocalStorage } from '../../shared/storage.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('أنواع السلف وفواتير الذمم وجدول الأيام', () => {
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

  let emp: string;
  let emp2: string;
  const typeId = async (code: string) =>
    ((await get('admin', '/payroll/loan-types')).body.data as { id: string; code: string }[]).find(
      (t) => t.code === code,
    )!.id;

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
        crypto: createFieldCrypto({
          keysSpec: `k1:${randomBytes(32).toString('base64')}`,
          currentKeyId: 'k1',
          digestKey: randomBytes(32).toString('base64'),
        }),
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-loans-'))),
      },
    });
    await makeUser('admin@acme.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    const mk = async (n: string) =>
      (
        await post('admin', '/employees', {
          firstNameAr: n,
          familyNameAr: 'تجربة',
          firstHireDate: '2025-01-01',
        })
      ).body.data.id as string;
    emp = await mk('أحمد');
    emp2 = await mk('سارة');
    expect(
      (
        await post('admin', `/employees/${emp}/salaries`, {
          currency: 'SAR',
          basicAmount: '1000',
          validFrom: '2025-01-01',
          components: [],
        })
      ).status,
    ).toBe(201);
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('الأنواع الافتراضية تُزرع تلقائياً ويمكن إضافة نوع جديد', async () => {
    const list = (await get('admin', '/payroll/loan-types')).body.data as { code: string }[];
    expect(list.map((t) => t.code).sort()).toEqual(['advance', 'loan', 'receivable']);
    const r = await post('admin', '/payroll/loan-types', {
      code: 'medical',
      nameAr: 'علاج',
      nameEn: 'Medical',
      color: '#e64980',
      disburses: false,
      maxInstallments: 3,
    });
    expect(r.status).toBe(201);
    const bad = await post('admin', '/payroll/loan-types', {
      code: 'x',
      nameAr: 'س',
      nameEn: 's',
      color: 'red',
    });
    expect(bad.status).toBe(400);
  });

  it('فاتورة ذمم: تُخصم في شهر الفاتورة ولا تُنشئ دفعة صرف', async () => {
    const t = await typeId('receivable');
    const r = await post('admin', '/payroll/loans', {
      employeeId: emp,
      typeId: t,
      currency: 'SAR',
      principal: '85',
      eventDate: '2026-03-05',
      reference: 'INV-1',
    });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({
      typeCode: 'receivable',
      eventDate: '2026-03-05',
      reference: 'INV-1',
      firstYear: 2026,
      firstMonth: 3,
      installmentsCount: 1,
    });
    const pays = await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx.selectFrom('payments').select('id').where('loanId', '=', r.body.data.id).execute(),
    );
    expect(pays).toHaveLength(0);
  });

  it('السلفة العادية تنشئ دفعة صرف، وعدد الأقساط محدود بالنوع', async () => {
    const r = await post('admin', '/payroll/loans', {
      employeeId: emp,
      kind: 'advance',
      currency: 'SAR',
      principal: '300',
      installmentsCount: 1,
      eventDate: '2026-03-10',
    });
    expect(r.status).toBe(201);
    const pays = await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx.selectFrom('payments').select('id').where('loanId', '=', r.body.data.id).execute(),
    );
    expect(pays).toHaveLength(1);
    const many = await post('admin', '/payroll/loans', {
      employeeId: emp,
      kind: 'advance',
      currency: 'SAR',
      principal: '300',
      installmentsCount: 13,
    });
    expect(many.status).toBe(400);
  });

  it('حد الأقساط الشهرية تنبيه لا منع', async () => {
    const t = await typeId('receivable');
    const got = (await get('admin', '/payroll/loan-types')).body.data as {
      id: string;
      version: number;
    }[];
    const cur = got.find((x) => x.id === t)!;
    const up = await request(api)
      .patch(`/api/v1/payroll/loan-types/${t}`)
      .set(as('admin'))
      .send({ monthlyLimitPercent: 10, version: cur.version });
    expect(up.status).toBe(200);
    const r = await post('admin', '/payroll/loans', {
      employeeId: emp,
      typeId: t,
      currency: 'SAR',
      principal: '500',
      eventDate: '2026-04-02',
    });
    expect(r.status).toBe(201);
    expect(r.body.meta.warnings).toEqual(['MONTHLY_LIMIT_EXCEEDED']);
  });

  it('إدخال دفعة فواتير لموظف واحد', async () => {
    const t = await typeId('receivable');
    const r = await post('admin', '/payroll/loans/bulk', {
      employeeId: emp2,
      typeId: t,
      currency: 'SAR',
      items: [
        { eventDate: '2026-03-05', reference: 'A1', amount: '40' },
        { eventDate: '2026-03-05', reference: 'A2', amount: '10' },
        { eventDate: '2026-03-20', amount: '25' },
      ],
    });
    expect(r.status).toBe(201);
    expect(r.body.data.ids).toHaveLength(3);
  });

  it('الجدول: صف لكل (موظف، نوع) وخلايا الأيام ومجاميعها', async () => {
    const res = await get('admin', '/payroll/loans-grid?year=2026&month=3');
    expect(res.status).toBe(200);
    const g = res.body.data;
    expect(g.days).toHaveLength(31);
    const e1 = g.rows.filter((r: { employeeId: string }) => r.employeeId === emp);
    expect(e1.map((r: { typeCode: string }) => r.typeCode).sort()).toEqual([
      'advance',
      'receivable',
    ]);
    const rec2 = g.rows.find(
      (r: { employeeId: string; typeCode: string }) =>
        r.employeeId === emp2 && r.typeCode === 'receivable',
    );
    expect(Number(rec2.cells['5'].amount)).toBe(50); // فاتورتان في اليوم نفسه
    expect(rec2.cells['5'].refs).toEqual(['A1', 'A2']);
    expect(Number(rec2.taken)).toBe(75);
    expect(Number(rec2.due)).toBe(75);
    expect(Number(g.totals['SAR'].perDay['5'])).toBe(135);
    // فلتر النوع
    const only = await get(
      'admin',
      `/payroll/loans-grid?year=2026&month=3&typeId=${await typeId('advance')}`,
    );
    expect(only.body.data.rows).toHaveLength(1);
  });

  it('تصدير Excel بخلايا مدموجة', async () => {
    const res = await request(api)
      .get('/api/v1/payroll/loans-grid?year=2026&month=3&format=xlsx')
      .set(as('admin'))
      .buffer()
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(res.status).toBe(200);
    expect((res.body as Buffer).subarray(0, 2).toString()).toBe('PK');
  });

  it('مرفقات الفاتورة: رفع وتنزيل وحذف، والنوع «يتطلب مرفقاً» يظهر في القائمة', async () => {
    const t = await typeId('receivable');
    await withTenant(admin, { companyId: acme }, (ctx) =>
      ctx.trx
        .updateTable('loanTypes')
        .set({ requiresAttachment: true })
        .where('id', '=', t)
        .execute(),
    );
    const loan = await post('admin', '/payroll/loans', {
      employeeId: emp,
      typeId: t,
      currency: 'SAR',
      principal: '40',
      eventDate: '2026-03-07',
      reference: 'INV-ATT',
    });
    const id = loan.body.data.id as string;
    expect(loan.body.data).toMatchObject({ requiresAttachment: true, attachmentsCount: 0 });
    const PDF = Buffer.from('%PDF-1.4\n%invoice content');
    const up = await request(api)
      .post(`/api/v1/payroll/loans/${id}/attachments`)
      .set(as('admin'))
      .set('Content-Type', 'application/octet-stream')
      .set('X-File-Name', encodeURIComponent('فاتورة.pdf'))
      .send(PDF);
    expect(up.status).toBe(201);
    const list = await get('admin', `/payroll/loans/${id}/attachments`);
    expect(list.body.data).toHaveLength(1);
    expect(list.body.data[0]).toMatchObject({ name: 'فاتورة.pdf', mimeType: 'application/pdf' });
    const dl = await request(api)
      .get(`/api/v1/payroll/loans/${id}/attachments/${list.body.data[0].id}/content`)
      .set(as('admin'))
      .buffer(true)
      .parse((r, cb) => {
        const chunks: Buffer[] = [];
        r.on('data', (c: Buffer) => chunks.push(c));
        r.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(dl.status).toBe(200);
    expect((dl.body as Buffer).equals(PDF)).toBe(true);
    // نوع ملف غير مسموح يُرفض
    const bad = await request(api)
      .post(`/api/v1/payroll/loans/${id}/attachments`)
      .set(as('admin'))
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('MZ not allowed'));
    expect(bad.status).toBeGreaterThanOrEqual(400);
    const one = (await get('admin', `/payroll/loans/${id}`)).body.data;
    expect(one.attachmentsCount).toBe(1);
    const del = await request(api)
      .delete(`/api/v1/payroll/loans/${id}/attachments/${list.body.data[0].id}`)
      .set(as('admin'));
    expect(del.status).toBe(204);
    expect((await get('admin', `/payroll/loans/${id}/attachments`)).body.data).toHaveLength(0);
    // سلفة غير موجودة
    expect(
      (await get('admin', '/payroll/loans/018f0000-0000-7000-8000-000000000000/attachments'))
        .status,
    ).toBe(404);
  });
});
