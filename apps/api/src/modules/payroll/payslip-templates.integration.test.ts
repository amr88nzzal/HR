import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { sql } from 'kysely';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { createLocalStorage } from '../../shared/storage.js';
import { loadPayslipDoc } from './payslip-doc.js';
import { hashOtp, payslipVerifyToken } from './payslip-verify.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};

describe('قوالب تصميم قسيمة الراتب', () => {
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
  let slip: string;
  const put = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));
  const base = {
    layout: 'side_by_side',
    headerFields: ['employeeName', 'jobTitle', 'month', 'basicSalary'],
    sections: ['header', 'lines', 'totals', 'ytd', 'notes', 'signature'],
    showPrintedAt: true,
    showLineCodes: true,
    accent: '#123456',
    footer: { ar: 'تذييل خاص', en: 'Custom footer' },
  };
  const pdfHtml = async () => {
    const r = await get('admin', `/payroll/payslips/${slip}/pdf`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    return rendered.at(-1)!;
  };

  it('تجهيز: دورة مقفلة بقسيمة واحدة', async () => {
    jan = (await post('admin', '/payroll/periods', { year: 2026, month: 1, currency: 'SAR' })).body
      .data.id as string;
    expect((await post('admin', `/payroll/periods/${jan}/calculate`)).status).toBe(200);
    expect((await post('admin', `/payroll/periods/${jan}/approve`)).status).toBe(200);
    expect((await post('admin', `/payroll/periods/${jan}/lock`)).status).toBe(200);
    slip = (
      (await get('admin', `/payroll/periods/${jan}/payslips`)).body.data as { id: string }[]
    )[0]!.id;
  });

  it('بلا قالب افتراضي: التصميم العمودي المدمج (لا تغيير في القسيمة)', async () => {
    const html = await pdfHtml();
    expect(html).toContain('أحمد');
    expect(html).toContain('3150.00');
    expect(html).not.toContain('side_by_side');
  });

  it('الصلاحيات: القراءة والإدارة منفصلتان', async () => {
    expect((await get('emp', '/payroll/payslip-templates')).status).toBe(403);
    expect((await get('admin', '/payroll/payslip-templates')).status).toBe(200);
    const r = await post('emp', '/payroll/payslip-templates', { nameAr: 'س', config: {} });
    expect(r.status).toBe(403);
  });

  let tpl: { id: string; version: number };
  it('إنشاء قالب بإعدادات صالحة، وتحقق صارم من الباقي', async () => {
    const ok = await post('admin', '/payroll/payslip-templates', {
      nameAr: 'جانبي',
      nameEn: 'Side',
      config: base,
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    tpl = ok.body.data;
    expect(ok.body.data.isDefault).toBe(false);
    for (const bad of [
      { ...base, accent: 'red' },
      { ...base, sections: ['header'] }, // بلا قسم البنود
      { ...base, sections: ['lines', 'lines'] },
      { ...base, headerFields: ['employeeName', 'employeeName'] },
      { ...base, headerFields: ['nope'] },
      { ...base, fontSize: 40 },
    ]) {
      const r = await post('admin', '/payroll/payslip-templates', { nameAr: 'x', config: bad });
      expect(r.status, JSON.stringify(bad)).toBe(400);
    }
  });

  it('تعيينه افتراضياً يغيّر القسيمة المطبوعة، والقديم يُلغى', async () => {
    expect((await post('admin', `/payroll/payslip-templates/${tpl.id}/default`)).status).toBe(204);
    const html = await pdfHtml();
    expect(html).toContain('#123456');
    expect(html).toContain('تذييل خاص');
    expect(html).toContain('الأرقام التراكمية للسنة');
    expect(html).toContain('توقيع الموظف');
    expect(html).toContain('تاريخ الطباعة');
    expect(html).toContain('3150.00');
    const second = await post('admin', '/payroll/payslip-templates', {
      nameAr: 'ثانٍ',
      config: {},
    });
    expect(
      (await post('admin', `/payroll/payslip-templates/${second.body.data.id}/default`)).status,
    ).toBe(204);
    const list = (await get('admin', '/payroll/payslip-templates')).body.data as {
      isDefault: boolean;
    }[];
    expect(list.filter((t) => t.isDefault)).toHaveLength(1);
    // العودة للمدمج
    expect((await post('admin', '/payroll/payslip-templates/use-builtin')).status).toBe(204);
    expect(await pdfHtml()).not.toContain('#123456');
  });

  it('تعديل بقفل تفاؤلي، وحذف', async () => {
    const up = await put('admin', `/payroll/payslip-templates/${tpl.id}`, {
      nameAr: 'جانبي معدّل',
      config: { ...base, accent: '#abcdef' },
      version: tpl.version,
    });
    expect(up.status, JSON.stringify(up.body)).toBe(200);
    expect(up.body.data.version).toBe(tpl.version + 1);
    const stale = await put('admin', `/payroll/payslip-templates/${tpl.id}`, {
      nameAr: 'x',
      config: base,
      version: tpl.version,
    });
    expect(stale.status).toBe(409);
    expect((await del('admin', `/payroll/payslip-templates/${tpl.id}`)).status).toBe(204);
    expect((await del('admin', `/payroll/payslip-templates/${tpl.id}`)).status).toBe(404);
  });

  it('المعاينة: عيّنة بإعدادات غير محفوظة، وقسيمة حقيقية، ولغة ثابتة', async () => {
    const sample = await post('admin', '/payroll/payslip-templates/preview', { config: base });
    expect(sample.status, JSON.stringify(sample.body)).toBe(200);
    expect(sample.body.data.html).toContain('نور الدين الجبور');
    expect(sample.body.data.html).toContain('#123456');
    const real = await post('admin', '/payroll/payslip-templates/preview', {
      config: base,
      payslipId: slip,
      lang: 'en',
    });
    expect(real.body.data.html).toContain('Total earnings');
    expect(real.body.data.html).toContain('3150.00');
    const noSlip = await post('admin', '/payroll/payslip-templates/preview', {
      config: base,
      payslipId: '018f0000-0000-7000-8000-000000000000',
    });
    expect(noSlip.status).toBe(404);
    const noAuth = await post('emp', '/payroll/payslip-templates/preview', { config: base });
    expect(noAuth.status).toBe(403);
  });

  it('إخفاء البنود الصفرية، وإفلات HTML في النصوص الحرة', async () => {
    const r = await post('admin', '/payroll/payslip-templates/preview', {
      config: { ...base, hideZeroLines: true, footer: { ar: '<script>alert(1)</script>', en: '' } },
    });
    expect(r.body.data.html).not.toContain('مكافآت');
    expect(r.body.data.html).not.toContain('<script>alert(1)');
    expect(r.body.data.html).toContain('&lt;script&gt;');
  });
  it('التحقق العام المؤمَّن: مطابقة الأرقام، القيمة السرية، OTP، القفل، والاسم الكامل بالإعداد', async () => {
    const d = await withTenant(admin, { companyId: acme }, (ctx) => loadPayslipDoc(ctx, slip));
    const token = payslipVerifyToken(settings.jwtSecret, acme, d);
    const url = `/api/v1/public/verify/payslip/${token}`;
    const setOpt = async (v: object) => {
      await admin.executeQuery(
        sql`delete from settings where company_id = ${acme} and key = 'payslipVerify'`.compile(
          admin,
        ),
      );
      await admin.executeQuery(
        sql`insert into settings (company_id, scope_type, key, value)
            values (${acme}, 'company', 'payslipVerify', ${JSON.stringify(v)}::jsonb)`.compile(
          admin,
        ),
      );
    };
    const base = {
      figures: true,
      otpTelegram: false,
      otpEmail: false,
      secretField: 'none',
      secretCustomKey: '',
      fullName: false,
    };
    await setOpt(base);
    // افتراضياً: اسم مقنّع، مطابقة الأرقام فقط
    const g = await request(api).get(url);
    expect(g.body.data.methods).toMatchObject({ figures: true, otpTelegram: false, secret: null });
    expect(g.body.data.holder).toContain('***');
    const right = {
      gross: d.gross,
      deductions: d.deductions,
      payable: d.payable,
    };
    expect((await request(api).post(`${url}/check`).send(right)).body.data.match).toBe(true);
    expect(
      (
        await request(api)
          .post(`${url}/check`)
          .send({ ...right, payable: '999999' })
      ).body.data.match,
    ).toBe(false);
    // الكشف معطّل ما لم تُفعَّل طريقة
    expect((await request(api).post(`${url}/reveal`).send({ secret: '1990-01-01' })).status).toBe(
      403,
    );
    expect((await request(api).post(`${url}/reveal`).send({ otp: '123456' })).status).toBe(403);

    // القيمة السرية: تاريخ الميلاد
    await admin.executeQuery(
      sql`update employees set birth_date = '1990-05-17'
           where id = (select employee_id from payslips where id = ${slip})`.compile(admin),
    );
    await setOpt({ ...base, secretField: 'birthDate', fullName: true });
    const g2 = await request(api).get(url);
    expect(g2.body.data.methods.secret).toBe('birthDate');
    expect(g2.body.data.holder).not.toContain('***');
    const bad = await request(api).post(`${url}/reveal`).send({ secret: '1990-05-18' });
    expect(bad.status).toBe(401);
    expect(JSON.stringify(bad.body)).not.toContain(d.payable);
    const good = await request(api).post(`${url}/reveal`).send({ secret: '1990-05-17' });
    expect(good.status).toBe(200);
    expect(good.body.data.payable).toBe(d.payable);
    expect(good.body.data.earnings.length).toBeGreaterThan(0);

    // OTP: رمز صحيح يعمل مرة واحدة فقط
    await setOpt({ ...base, otpEmail: true });
    await admin.executeQuery(
      sql`insert into payslip_verify_otps (company_id, payslip_id, channel, code_hash, expires_at, created_at)
          values (${acme}, ${slip}, 'email', ${hashOtp(settings.jwtSecret, slip, '482913')},
                  now() + interval '5 minutes', now() - interval '5 minutes')`.compile(admin),
    );
    expect((await request(api).post(`${url}/reveal`).send({ otp: '000000' })).status).toBe(401);
    const ok = await request(api).post(`${url}/reveal`).send({ otp: '482913' });
    expect(ok.status).toBe(200);
    expect(ok.body.data.net).toBe(d.net);
    expect((await request(api).post(`${url}/reveal`).send({ otp: '482913' })).status).toBe(401);
    // الإرسال بلا قناة مهيّأة يفشل بوضوح
    expect((await request(api).post(`${url}/otp`).send({ channel: 'email' })).status).toBe(409);

    // قفل بعد 5 محاولات خاطئة
    await setOpt({ ...base, secretField: 'birthDate' });
    for (let i = 0; i < 5; i++)
      await request(api)
        .post(`${url}/reveal`)
        .send({ secret: `2000-01-0${i + 1}` });
    const locked = await request(api).post(`${url}/reveal`).send({ secret: '1990-05-17' });
    expect(locked.status).toBe(429);
  });
  it('QR التحقق: يظهر بقسم qr، والتحقق العام يطابق ثم يرفض بعد أي تعديل ولا يكشف مبالغ', async () => {
    const cfg = { ...base, sections: [...base.sections, 'qr'] };
    const withQr = await post('admin', '/payroll/payslip-templates/preview', {
      config: cfg,
      payslipId: slip,
    });
    expect(withQr.body.data.html).toContain('data:image/png;base64');
    const without = await post('admin', '/payroll/payslip-templates/preview', {
      config: base,
      payslipId: slip,
    });
    expect(without.body.data.html).not.toContain('data:image/png;base64');

    const d = await withTenant(admin, { companyId: acme }, (ctx) => loadPayslipDoc(ctx, slip));
    const token = payslipVerifyToken(settings.jwtSecret, acme, d);
    const ok = await request(api).get(`/api/v1/public/verify/payslip/${token}`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.valid).toBe(true);
    expect(ok.body.data.company).toBe('شركة أكمي');
    expect(ok.body.data.holder).toContain('***');
    expect(JSON.stringify(ok.body)).not.toContain(d.net);
    expect(JSON.stringify(ok.body)).not.toContain('أحمد');

    // بصمة خاطئة: لا بيانات
    const [id] = token.split('.') as [string];
    const forged = await request(api).get(`/api/v1/public/verify/payslip/${id}.${'0'.repeat(32)}`);
    expect(forged.body.data).toEqual({ valid: false, status: 'mismatch' });
    // شكل غير صالح ومعرّف غير موجود
    expect((await request(api).get('/api/v1/public/verify/payslip/xyz')).status).toBe(404);
    const ghost = `${'0'.repeat(32)}.${'0'.repeat(32)}`;
    expect((await request(api).get(`/api/v1/public/verify/payslip/${ghost}`)).body.data.valid).toBe(
      false,
    );

    // تعديل الصافي بعد الطباعة يُسقط التطابق
    await admin.executeQuery(
      sql`update payslips set net_amount = net_amount + 1 where id = ${slip}`.compile(admin),
    );
    const tampered = await request(api).get(`/api/v1/public/verify/payslip/${token}`);
    expect(tampered.body.data).toEqual({ valid: false, status: 'mismatch' });
  });
});
