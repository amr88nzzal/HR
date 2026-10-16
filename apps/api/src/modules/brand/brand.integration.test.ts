import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import sharp from 'sharp';
import { makeDocx } from '../../test/docx.js';
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

describe('الهوية البصرية B: الشعار والترويسة بلغتين', () => {
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

  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));
  const put = (who: string, p: string, body: Buffer) =>
    request(api)
      .put(`/api/v1${p}`)
      .set(as(who))
      .set('Content-Type', 'application/octet-stream')
      .send(body);
  const put2 = (who: string, p: string, body: object) =>
    request(api).put(`/api/v1${p}`).set(as(who)).send(body);
  const png = (r: number, g: number, b: number) =>
    sharp({ create: { width: 40, height: 20, channels: 3, background: { r, g, b } } })
      .png()
      .toBuffer();
  const SVG_OK = Buffer.from(
    '<svg xmlns="http://www.w3.org/2000/svg" width="60" height="30"><rect width="60" height="30" fill="#0a0"/></svg>',
  );
  let emp: string;
  let tplAr: string;
  let tplEn: string;

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
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-brand-'))),
        render: Object.assign(
          async (html: string) => {
            rendered.push(html);
            return Buffer.from(`%PDF-1.4 fake ${rendered.length}`);
          },
          { docxToPdf: async () => Buffer.from('%PDF-1.4 fake docx') },
        ),
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('emp@acme.test', 'employee');
    tokens['admin'] = await login('admin@acme.test');
    tokens['emp'] = await login('emp@acme.test');
    emp = (
      await post('admin', '/employees', {
        firstNameAr: 'أحمد',
        familyNameAr: 'الخطيب',
        firstNameEn: 'Ahmad',
        familyNameEn: 'Khatib',
      })
    ).body.data.id;
    const mk = async (code: string, language: string, extra: object = {}) =>
      (
        await post('admin', '/letter-templates', {
          code,
          nameAr: code,
          language,
          bodyHtml: '<p>{{employee.fullName}}</p>',
          ...extra,
        })
      ).body.data.id as string;
    tplAr = await mk('cert-ar', 'ar');
    tplEn = await mk('cert-en', 'en');
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('الصلاحيات: الموظف لا يقرأ الإعدادات ولا يعدّلها، وإعدادات فارغة افتراضياً', async () => {
    expect((await get('emp', '/company-brand')).status).toBe(403);
    expect((await put2('emp', '/company-brand', { phone: '1' })).status).toBe(403);
    const r = await get('admin', '/company-brand');
    expect(r.status).toBe(200);
    expect(r.body.data.slots.logo_ar).toBe(false);
  });

  it('النصوص: تحقق البريد والموقع، وتعارض الإصدار', async () => {
    expect((await put2('admin', '/company-brand', { email: 'bad' })).status).toBe(400);
    expect((await put2('admin', '/company-brand', { website: 'javascript:1' })).status).toBe(400);
    const ok = await put2('admin', '/company-brand', {
      legalNameAr: 'شركة أكمي للتجارة',
      legalNameEn: 'Acme Trading Co.',
      addressAr: 'الرياض، شارع الملك فهد',
      addressEn: 'King Fahd Rd, Riyadh',
      footerAr: 'سجل تجاري 123',
      footerEn: 'CR 123',
      phone: '+966 11 000 0000',
      email: 'info@acme.test',
      taxNo: '300000000000003',
    });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const stale = await put2('admin', '/company-brand', { phone: '2', version: 99 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
  });

  it('رفع الصور: PNG وSVG سليم يُقبلان ويُخزَّنان PNG، وتُرفض SVG الضارة والأنواع الأخرى', async () => {
    expect((await put('admin', '/company-brand/files/logo_ar', await png(200, 0, 0))).status).toBe(
      200,
    );
    expect((await put('admin', '/company-brand/files/logo_en', await png(0, 0, 200))).status).toBe(
      200,
    );
    expect((await put('admin', '/company-brand/files/logo_dark_ar', SVG_OK)).status).toBe(200);
    const stored = await get('admin', '/company-brand/files/logo_dark_ar')
      .buffer(true)
      .parse((res, cb) => {
        const c: Buffer[] = [];
        res.on('data', (x: Buffer) => c.push(x));
        res.on('end', () => cb(null, Buffer.concat(c)));
      });
    expect(stored.headers['content-type']).toBe('image/png');
    expect((stored.body as Buffer).subarray(1, 4).toString()).toBe('PNG');

    const evil = (inner: string) =>
      Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10">${inner}</svg>`);
    for (const bad of [
      evil('<script>alert(1)</script>'),
      evil('<rect width="1" height="1" onload="x()"/>'),
      evil('<image href="https://evil.test/x.png"/>'),
      evil('<foreignObject><div/></foreignObject>'),
      Buffer.from(
        '<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY x "y">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
    ]) {
      const r = await put('admin', '/company-brand/files/stamp', bad);
      expect(r.status, bad.toString()).toBe(400);
      expect(r.body.error.code).toBe('INVALID_SVG');
    }
    expect(
      (await put('admin', '/company-brand/files/stamp', Buffer.from('hello world, not an image')))
        .status,
    ).toBe(415);
    expect(
      (await put('admin', '/company-brand/files/stamp', Buffer.alloc(1_100_000, 1))).status,
    ).toBe(413);
    expect((await put('admin', '/company-brand/files/nope', await png(1, 1, 1))).status).toBe(404);
    expect((await put('emp', '/company-brand/files/stamp', await png(1, 1, 1))).status).toBe(403);
    expect((await get('admin', '/company-brand')).body.data.slots).toMatchObject({
      logo_ar: true,
      logo_en: true,
      logo_dark_ar: true,
      stamp: false,
    });
  });

  it('الشعار للتطبيق: أي مستخدم مسجّل، مع رجوع للغة الأخرى والسمة الفاتحة، وعام بالـ slug لشاشة الدخول', async () => {
    const r = await get('emp', '/company-brand/logo?lang=ar&theme=light');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    // داكن بالإنجليزية: لا نسخة داكنة إنجليزية فيُرجَع للداكن العربي ثم الشعار
    expect((await get('emp', '/company-brand/logo?lang=en&theme=dark')).status).toBe(200);
    const pub = await request(api).get('/api/v1/public/brand/acme/logo?lang=en');
    expect(pub.status).toBe(200);
    expect(pub.headers['content-type']).toBe('image/png');
    expect((await request(api).get('/api/v1/public/brand/default/logo')).status).toBe(200);
    expect((await request(api).get('/api/v1/public/brand/other/logo')).status).toBe(404);
    expect(
      (await request(api).get('/api/v1/public/brand/acme/logo').set('Origin', 'x')).status,
    ).toBe(200);
  });

  it('المعاينة الحيّة: بلغتين وبنصوص غير محفوظة', async () => {
    const ar = await post('admin', '/company-brand/preview', { lang: 'ar' });
    expect(ar.status).toBe(200);
    expect(ar.body.data.html).toContain('dir="rtl"');
    expect(ar.body.data.html).toContain('شركة أكمي للتجارة');
    expect(ar.body.data.html).toContain('data:image/png;base64,');
    const en = await post('admin', '/company-brand/preview', {
      lang: 'en',
      fields: { legalNameEn: 'Draft Name <b>x</b>' },
    });
    expect(en.body.data.html).toContain('dir="ltr"');
    expect(en.body.data.html).toContain('Draft Name &lt;b&gt;x&lt;/b&gt;');
    expect(en.body.data.html).not.toContain('Acme Trading');
    expect((await post('emp', '/company-brand/preview', { lang: 'ar' })).status).toBe(403);
  });

  it('الوثائق: كل لغة بترويستها وشعارها، والتغليف اختياري لكل قالب', async () => {
    rendered.length = 0;
    const a = await post('admin', '/issued-documents', { templateId: tplAr, employeeId: emp });
    const e = await post('admin', '/issued-documents', { templateId: tplEn, employeeId: emp });
    expect(a.status, JSON.stringify(a.body)).toBe(201);
    expect(e.status).toBe(201);
    expect(rendered[0]).toContain('class="lh-header"');
    expect(rendered[0]).toContain('شركة أكمي للتجارة');
    expect(rendered[0]).toContain('الرقم الضريبي');
    expect(rendered[0]).toContain('سجل تجاري 123');
    expect(rendered[1]).toContain('Acme Trading Co.');
    expect(rendered[1]).toContain('Tax No.');
    expect(rendered[1]).not.toContain('شركة أكمي للتجارة');
    const logo = (h: string) => /data:image\/png;base64,[A-Za-z0-9+/=]+/.exec(h)?.[0];
    expect(logo(rendered[0]!)).toBeTruthy();
    expect(logo(rendered[0]!)).not.toBe(logo(rendered[1]!));

    // قالب بلا تغليف + متغيرات يدوية
    const manual = (
      await post('admin', '/letter-templates', {
        code: 'manual',
        nameAr: 'يدوي',
        language: 'ar',
        useLetterhead: false,
        bodyHtml:
          '<div>{{company.legalName}}</div>{{company.header}}<p>{{employee.fullName}}</p>{{company.footer}}',
      })
    ).body.data;
    expect(manual.useLetterhead).toBe(false);
    rendered.length = 0;
    await post('admin', '/issued-documents', { templateId: manual.id, employeeId: emp });
    expect(rendered[0]!.match(/class="lh-header"/g)).toHaveLength(1); // من المتغير وحده
    expect(rendered[0]).toContain('class="lh-footer"');
  });

  it('الوثيقة الصادرة لا تتغير بتعديل الترويسة لاحقاً', async () => {
    const list = (await get('admin', `/issued-documents?employeeId=${emp}`)).body.data as {
      id: string;
      templateId: string;
    }[];
    const doc = list.find((d) => d.templateId === tplAr)!;
    const read = async () =>
      (await get('admin', `/issued-documents/${doc.id}/content`).buffer(true)).text;
    const before = await read();
    await put2('admin', '/company-brand', { legalNameAr: 'اسم جديد تماماً' });
    await put('admin', '/company-brand/files/logo_ar', await png(0, 200, 0));
    expect(await read()).toBe(before);
    const next = await post('admin', '/issued-documents', { templateId: tplAr, employeeId: emp });
    expect(next.status).toBe(201);
    expect(rendered.at(-1)).toContain('اسم جديد تماماً');
  });

  it('قالب DOCX لا يقبل الشعار ولا كتل HTML لكن يقبل نصوص الشركة', async () => {
    const q = 'code=docx1&nameAr=%D9%88%D8%B1%D8%AF&language=ar';
    const up = (buf: Buffer) =>
      request(api)
        .post(`/api/v1/letter-templates/docx?${q}`)
        .set(as('admin'))
        .set('Content-Type', 'application/octet-stream')
        .send(buf);
    expect((await up(makeDocx(['{{company.logo}}']))).status).toBe(400);
    expect((await up(makeDocx(['{{company.header}}']))).status).toBe(400);
    expect((await up(makeDocx(['{{company.legalName}} {{company.taxNo}}']))).status).toBe(201);
  });

  it('حذف الصورة: يختفي الشعار العام وتبقى الترويسة نصاً', async () => {
    for (const s of ['logo_ar', 'logo_en', 'logo_dark_ar']) {
      expect((await del('admin', `/company-brand/files/${s}`)).status).toBe(204);
    }
    expect((await request(api).get('/api/v1/public/brand/acme/logo')).status).toBe(404);
    expect((await get('emp', '/company-brand/logo')).status).toBe(404);
    const p = await post('admin', '/company-brand/preview', { lang: 'ar' });
    expect(p.body.data.html).toContain('اسم جديد تماماً');
    expect(p.body.data.html).not.toContain('data:image/png');
  });
});
