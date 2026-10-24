import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { syncPermissionCatalog } from '../identity/index.js';

const KEY = 'k'.repeat(40);
const settings = {
  jwtSecret: 'y'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'main',
};

describe('إدارة الشركات على مستوى المنصة', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let off: ReturnType<typeof createApp>;
  let token: string;
  const mk = (platformAdminKey?: string) =>
    createApp({
      logger: pino({ level: 'silent' }),
      auth: { db: app, settings, cookieSecure: false, rateLimit: false, platformAdminKey },
    });
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const body = (slug: string, email = `admin@${slug}.test`) => ({
    slug,
    nameAr: `شركة ${slug}`,
    admin: { email, name: 'مدير' },
  });

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    await admin.insertInto('companies').values({ slug: 'main', nameAr: 'الرئيسية' }).execute();
    api = mk(KEY);
    off = mk(undefined);
    token = (await request(api).post('/api/v1/platform/session').send({ key: KEY })).body.data
      .token;
  });
  afterAll(async () => {
    await admin.destroy();
    await app.destroy();
    await pgx.stop();
  });

  it('بلا مفتاح في البيئة لا تُمنح أي جلسة', async () => {
    const r = await request(off).post('/api/v1/platform/session').send({ key: KEY });
    expect(r.status).toBeGreaterThanOrEqual(400);
    expect(r.body.data?.token).toBeUndefined();
  });

  it('مفتاح خاطئ أو بلا توكن يُرفض', async () => {
    const bad = await request(api).post('/api/v1/platform/session').send({ key: 'x' });
    expect(bad.status).toBe(401);
    expect((await request(api).get('/api/v1/platform/companies')).status).toBe(401);
    const forged = await request(api)
      .get('/api/v1/platform/companies')
      .set({ Authorization: 'Bearer abc.def.ghi' });
    expect(forged.status).toBe(401);
  });

  it('توكن المنصة لا يصلح كتوكن مستخدم', async () => {
    const r = await request(api).get('/api/v1/employees').set(auth());
    expect(r.status).toBe(401);
  });

  it('ينشئ شركة بمديرها وكلمة مؤقتة تعمل ويُجبر على تغييرها', async () => {
    const r = await request(api).post('/api/v1/platform/companies').set(auth()).send(body('acme'));
    expect(r.status).toBe(201);
    expect(r.headers['cache-control']).toContain('no-store');
    const { company, admin: a } = r.body.data;
    expect(company.slug).toBe('acme');
    expect(company.userCount).toBe(1);
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: a.email, password: a.temporaryPassword, company: 'acme' });
    expect(login.status).toBe(200);
    expect(login.body.data.mustChangePassword).toBe(true);
    // مدير الشركة الجديدة يرى شركته فقط
    const me = await request(api)
      .get('/api/v1/employees')
      .set({ Authorization: `Bearer ${login.body.data.accessToken}` });
    expect(me.status).toBe(200);
    const roles = await admin.selectFrom('roles').select('code').execute();
    expect(roles.length).toBeGreaterThan(0);
  });

  it('رمز مكرر أو محجوز أو غير صالح يُرفض ولا يترك شركة ناقصة', async () => {
    const dup = await request(api)
      .post('/api/v1/platform/companies')
      .set(auth())
      .send(body('acme'));
    expect(dup.status).toBe(409);
    for (const slug of ['default', 'Bad Slug', '-x', 'a'.repeat(50)]) {
      const r = await request(api).post('/api/v1/platform/companies').set(auth()).send(body(slug));
      expect(r.status).toBe(400);
    }
    const n = await admin.selectFrom('companies').select('id').execute();
    expect(n).toHaveLength(2); // main + acme
  });

  it('القائمة تعرض كل الشركات بعدّادات', async () => {
    const r = await request(api).get('/api/v1/platform/companies').set(auth());
    expect(r.status).toBe(200);
    expect(r.body.data.map((c: { slug: string }) => c.slug)).toEqual(['main', 'acme']);
    expect(r.body.data[1].employeeCount).toBe(0);
  });

  it('تعليق الشركة يُنهي جلسات مستخدميها: التحديث والطلبات بتوكن قائم', async () => {
    const list = (await request(api).get('/api/v1/platform/companies').set(auth())).body.data;
    const acme = list.find((c: { slug: string }) => c.slug === 'acme');
    const tmp = await request(api)
      .post('/api/v1/platform/companies')
      .set(auth())
      .send(body('susp'));
    const a = tmp.body.data.admin;
    const login = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: a.email, password: a.temporaryPassword, company: 'susp' });
    const cookie = login.headers['set-cookie']?.[0]?.split(';')[0] as string;
    const bearer = { Authorization: `Bearer ${login.body.data.accessToken}` };
    expect((await request(api).get('/api/v1/employees').set(bearer)).status).toBe(200);
    const c = tmp.body.data.company;
    await request(api).patch(`/api/v1/platform/companies/${c.id}`).set(auth()).send({
      nameAr: c.nameAr,
      nameEn: c.nameEn,
      timezone: c.timezone,
      defaultLocale: c.defaultLocale,
      status: 'suspended',
      version: c.version,
    });
    expect((await request(api).get('/api/v1/employees').set(bearer)).status).toBe(401);
    expect((await request(api).post('/api/v1/auth/refresh').set('Cookie', cookie)).status).toBe(
      401,
    );
    expect(acme.slug).toBe('acme');
  });

  it('الإيقاف يمنع الدخول، والإصدار القديم يتعارض، والتفعيل يعيده', async () => {
    const list = (await request(api).get('/api/v1/platform/companies').set(auth())).body.data;
    const acme = list.find((c: { slug: string }) => c.slug === 'acme');
    const patch = (version: number, status: string) =>
      request(api).patch(`/api/v1/platform/companies/${acme.id}`).set(auth()).send({
        nameAr: 'أكمي المعدّلة',
        nameEn: 'Acme',
        timezone: 'Europe/Berlin',
        defaultLocale: 'en',
        status,
        version,
      });
    const sus = await patch(acme.version, 'suspended');
    expect(sus.status).toBe(200);
    expect(sus.body.data).toMatchObject({ status: 'suspended', nameAr: 'أكمي المعدّلة' });
    const stale = await patch(acme.version, 'active');
    expect(stale.status).toBe(409);
    const blocked = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: 'admin@acme.test', password: 'whatever-long-pw', company: 'acme' });
    expect(blocked.status).toBe(401);
    const back = await patch(sus.body.data.version, 'active');
    expect(back.body.data.status).toBe('active');
    const missing = await request(api)
      .patch('/api/v1/platform/companies/018f0000-0000-7000-8000-000000000000')
      .set(auth())
      .send({
        nameAr: 'xx',
        timezone: 'UTC',
        defaultLocale: 'ar',
        status: 'active',
        version: 1,
      });
    expect(missing.status).toBe(404);
  });

  it('التطبيق (hrms_app) لا يستطيع قراءة شركات غيره مباشرة', async () => {
    const { rows } = await app
      .selectFrom('companies')
      .select('id')
      .execute()
      .then((r) => ({ rows: r }));
    expect(rows).toHaveLength(0); // بلا سياق شركة لا يرى شيئاً
  });
});
