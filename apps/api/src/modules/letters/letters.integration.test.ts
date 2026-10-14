import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createLocalStorage } from '../../shared/storage.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('الوثائق الصادرة 6a: قوالب HTML وإصدار PDF', () => {
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
      return user.id;
    });
  const login = async (email: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company: 'acme' })
    ).body.data.accessToken as string;

  let emp: string;
  const BODY_AR =
    '<h1>شهادة عمل</h1><p>تشهد {{company.name}} بأن {{employee.fullName}} ({{employee.employeeNo}}) يعمل بوظيفة {{job.title}} منذ {{employee.hireDate}}.</p>';

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    acme = (
      await admin
        .insertInto('companies')
        .values({ slug: 'acme', nameAr: 'شركة أكمي', nameEn: 'Acme Co' })
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
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-letters-'))),
        render: async (html) => {
          rendered.push(html);
          return Buffer.from('%PDF-1.4 fake pdf bytes');
        },
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
    const branch = (await post('admin', '/branches', { code: 'RUH', nameAr: 'الرياض' })).body.data
      .id;
    const dept = (
      await post('admin', '/departments', { code: 'IT', nameAr: 'تقنية', branchIds: [branch] })
    ).body.data.id;
    const title = (
      await post('admin', '/job-titles', { code: 'DEV', nameAr: 'مطوّر', nameEn: 'Developer' })
    ).body.data.id;
    const e = (
      await post('admin', '/employees', {
        firstNameAr: 'أحمد',
        familyNameAr: 'الخطيب <b>',
        firstNameEn: 'Ahmad',
        familyNameEn: 'Khatib',
      })
    ).body.data;
    emp = e.id;
    await admin
      .updateTable('employees')
      .set({ firstHireDate: '2024-03-01' })
      .where('id', '=', emp)
      .execute();
    await admin
      .insertInto('employments')
      .values({
        companyId: acme,
        employeeId: emp,
        branchId: branch,
        departmentId: dept,
        jobTitleId: title,
        employmentType: 'full_time',
        validFrom: '2024-03-01',
      })
      .execute();
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  it('إنشاء قالب بإصدار أول مفعّل، ورفض القوالب غير الآمنة والمتغيرات المجهولة', async () => {
    const ok = await post('admin', '/letter-templates', {
      code: 'EMP-CERT-AR',
      nameAr: 'شهادة عمل',
      language: 'ar',
      bodyHtml: BODY_AR,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.activeVersionId).toBeTruthy();
    const bad = async (bodyHtml: string, code: string) => {
      const r = await post('admin', '/letter-templates', {
        code,
        nameAr: 'x',
        language: 'ar',
        bodyHtml,
      });
      expect(r.status).toBe(400);
      expect(r.body.error.code).toBe('INVALID_TEMPLATE');
      return r.body.error.details.problems as string[];
    };
    expect((await bad('<script>alert(1)</script>', 'B1')).join()).toContain('script');
    expect((await bad('<p onclick="x()">hi</p>', 'B2')).join()).toContain('الأحداث');
    expect((await bad('<img src="http://evil/x.png">', 'B3')).join()).toContain('الخارجية');
    expect((await bad('<p>{{employee.salary}}</p>', 'B4')).join()).toContain('employee.salary');
    expect(
      (
        await post('admin', '/letter-templates', {
          code: 'EMP-CERT-AR',
          nameAr: 'x',
          language: 'ar',
          bodyHtml: 'x',
        })
      ).status,
    ).toBe(409);
  });

  it('المعاينة تملأ المتغيرات مع الهروب من HTML وعزل التواريخ والأكواد', async () => {
    const t = (await get('admin', '/letter-templates')).body.data[0];
    const r = await post('admin', `/letter-templates/${t.id}/preview`, { employeeId: emp });
    expect(r.status).toBe(200);
    const html = r.body.data.html as string;
    expect(html).toContain('dir="rtl"');
    expect(html).toContain('شركة أكمي');
    expect(html).toContain('أحمد');
    expect(html).toContain('&lt;b&gt;'); // الهروب
    expect(html).not.toContain('<b>');
    expect(html).toContain('<span dir="ltr"');
    expect(html).toContain('2024-03-01');
    expect(html).toContain('مطوّر');
  });

  it('الإصدارات: مسودة جديدة لا تغيّر المفعّل، والتفعيل والتراجع', async () => {
    const t = (await get('admin', '/letter-templates')).body.data[0];
    const v2 = await post('admin', `/letter-templates/${t.id}/versions`, {
      bodyHtml: '<p>النسخة الثانية {{employee.fullName}}</p>',
      note: 'تبسيط',
    });
    expect(v2.status).toBe(201);
    expect(v2.body.data.versionNo).toBe(2);
    let d = (await get('admin', `/letter-templates/${t.id}`)).body.data;
    expect(d.versions.find((v: { versionNo: number }) => v.versionNo === 1).status).toBe('active');
    await post('admin', `/letter-templates/${t.id}/versions/${v2.body.data.id}/activate`);
    d = (await get('admin', `/letter-templates/${t.id}`)).body.data;
    expect(d.activeVersionId).toBe(v2.body.data.id);
    expect(d.versions.find((v: { versionNo: number }) => v.versionNo === 1).status).toBe(
      'archived',
    );
    // تراجع إلى الأول
    const v1 = d.versions.find((v: { versionNo: number }) => v.versionNo === 1);
    await post('admin', `/letter-templates/${t.id}/versions/${v1.id}/activate`);
    expect((await get('admin', `/letter-templates/${t.id}`)).body.data.activeVersionId).toBe(v1.id);
  });

  it('إصدار وثيقة: PDF مخزَّن ولقطة قيم وسجل وتنزيل؛ والموظف العادي ممنوع', async () => {
    const t = (await get('admin', '/letter-templates')).body.data[0];
    const r = await post('admin', '/issued-documents', { templateId: t.id, employeeId: emp });
    expect(r.status).toBe(201);
    expect(rendered).toHaveLength(1);
    expect(rendered[0]).toContain('الخطيب');
    const row = await admin
      .selectFrom('issuedDocuments')
      .selectAll()
      .where('id', '=', r.body.data.id)
      .executeTakeFirstOrThrow();
    expect(row.templateHash).toHaveLength(64);
    expect((row.data as Record<string, string>)['employee.fullName']).toContain('أحمد');
    const dl = await get('admin', `/issued-documents/${r.body.data.id}/content`).buffer(true);
    expect(dl.status).toBe(200);
    expect(dl.headers['content-type']).toContain('application/pdf');
    const list = await get('admin', `/issued-documents?employeeId=${emp}`);
    expect(list.body.meta.total).toBe(1);
    expect(
      (await post('emp', '/issued-documents', { templateId: t.id, employeeId: emp })).status,
    ).toBe(403);
    expect((await get('emp', '/issued-documents')).status).toBe(403);
    // قالب مستعمل: لا يُحذف
    expect(
      (await request(api).delete(`/api/v1/letter-templates/${t.id}`).set(as('admin'))).status,
    ).toBe(409);
  });

  it('قالب إنجليزي: اتجاه LTR وأسماء إنجليزية؛ والقالب المعطّل لا يُصدر', async () => {
    const en = await post('admin', '/letter-templates', {
      code: 'EMP-CERT-EN',
      nameAr: 'شهادة إنجليزية',
      nameEn: 'Employment certificate',
      language: 'en',
      bodyHtml: '<p>{{employee.fullName}} works at {{company.name}} as {{job.title}}.</p>',
    });
    const pv = await post('admin', `/letter-templates/${en.body.data.id}/preview`, {
      employeeId: emp,
    });
    expect(pv.body.data.html).toContain('dir="ltr"');
    expect(pv.body.data.html).toContain('Ahmad Khatib');
    expect(pv.body.data.html).toContain('Acme Co');
    expect(pv.body.data.html).toContain('Developer');
    await request(api)
      .patch(`/api/v1/letter-templates/${en.body.data.id}`)
      .set(as('admin'))
      .send({ isActive: false });
    const r = await post('admin', '/issued-documents', {
      templateId: en.body.data.id,
      employeeId: emp,
    });
    expect(r.status).toBe(409);
  });

  it('الترقيم التسلسلي السنوي + QR + التحقق العام بلا جلسة (اسم مقنّع) + الإبطال', async () => {
    const tpl = await post('admin', '/letter-templates', {
      code: 'NUM-CERT',
      nameAr: 'شهادة مرقّمة',
      language: 'ar',
      bodyHtml: '<p>رقم {{document.number}}</p>{{document.qr}}<p>{{document.verifyUrl}}</p>',
    });
    expect(tpl.status).toBe(201);
    const before = rendered.length;
    const a = await post('admin', '/issued-documents', {
      templateId: tpl.body.data.id,
      employeeId: emp,
    });
    const b = await post('admin', '/issued-documents', {
      templateId: tpl.body.data.id,
      employeeId: emp,
    });
    const year = String(new Date().getUTCFullYear());
    expect(a.body.data.docNumber).toMatch(new RegExp(`^NUM-CERT-${year}-000001$`));
    expect(b.body.data.docNumber).toMatch(new RegExp(`^NUM-CERT-${year}-000002$`));
    // QR كصورة PNG مضمّنة ورابط التحقق في الصفحة المرسلة للتحويل
    expect(rendered[before]).toContain('<img src="data:image/png;base64,');
    const token = (
      await admin
        .selectFrom('issuedDocuments')
        .select('verifyToken')
        .where('id', '=', a.body.data.id)
        .executeTakeFirstOrThrow()
    ).verifyToken as string;
    expect(token.length).toBeGreaterThanOrEqual(30);
    expect(rendered[before]).toContain(`https://hr.example.com/verify/${token}`);

    // التحقق العام: بلا Authorization
    const v = await request(api).get(`/api/v1/public/verify/${token}`);
    expect(v.status).toBe(200);
    expect(v.body.data).toMatchObject({
      valid: true,
      status: 'valid',
      number: a.body.data.docNumber,
      type: 'شهادة مرقّمة',
      company: 'شركة أكمي',
    });
    expect(v.body.data.holder).toBe('أح*** ال*** <b>***'.replace('<b>***', '<b***'));
    expect(JSON.stringify(v.body)).not.toContain('الخطيب');
    expect(v.body.data.fileSha256).toHaveLength(64);
    expect((await request(api).get('/api/v1/public/verify/' + 'x'.repeat(30))).status).toBe(404);
    expect((await request(api).get('/api/v1/public/verify/short')).status).toBe(404);

    // الإبطال: يتطلب صلاحية وسبباً، فيصير التحقق «مبطلة»
    expect(
      (await post('emp', `/issued-documents/${a.body.data.id}/revoke`, { reason: 'x' })).status,
    ).toBe(403);
    expect((await post('admin', `/issued-documents/${a.body.data.id}/revoke`, {})).status).toBe(
      400,
    );
    const rv = await post('admin', `/issued-documents/${a.body.data.id}/revoke`, {
      reason: 'صدرت بالخطأ',
    });
    expect(rv.status).toBe(200);
    expect(rv.body.data.revokedAt).toBeTruthy();
    const v2 = await request(api).get(`/api/v1/public/verify/${token}`);
    expect(v2.body.data).toMatchObject({ valid: false, status: 'revoked' });
    expect(
      (await post('admin', `/issued-documents/${a.body.data.id}/revoke`, { reason: 'مرة ثانية' }))
        .status,
    ).toBe(409);
  });
});
