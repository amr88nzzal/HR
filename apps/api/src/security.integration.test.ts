import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Router } from 'express';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDb, type Db } from './db/index.js';
import { withTenant } from './db/tenant.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from './modules/identity/index.js';
import { createLocalStorage } from './shared/storage.js';
import { startTestPg, type TestPg } from './test/pg.js';

/**
 * مراجعة أمنية آلية على كل مسارات الـ API:
 *  - بلا توكن: 401 دائماً (عدا قائمة العام الصريحة)
 *  - مستخدم موثَّق بلا أي صلاحية: لا نجاح 2xx إلا للقائمة الصريحة «موثَّق فقط»
 *  - لا 5xx أبداً مع مدخلات فارغة (حتى للمدير)
 *  - عزل الشركات: مدير شركة أخرى لا يرى بيانات شركتنا في أي قائمة بلا معاملات
 * المسارات تُجمع من الراوترات الفعلية (لا قائمة يدوية) فأي مسار جديد يدخل الفحص تلقائياً.
 */

type Rec = {
  routes: { path: string; route: { methods: Record<string, boolean> } }[];
  mounts: { child: unknown; path: string }[];
};
const recs = new Map<unknown, Rec>();
const rec = (r: unknown): Rec => {
  let x = recs.get(r);
  if (!x) recs.set(r, (x = { routes: [], mounts: [] }));
  return x;
};
type Proto = {
  route: (this: unknown, p: string) => { methods: Record<string, boolean> };
  use: (this: unknown, ...a: unknown[]) => unknown;
};
const proto = (Router as unknown as { prototype: Proto }).prototype;
const origRoute = proto.route;
const origUse = proto.use;
proto.route = function (this: unknown, p: string) {
  const r = origRoute.call(this, p);
  rec(this).routes.push({ path: p, route: r });
  return r;
};
proto.use = function (this: unknown, ...a: unknown[]) {
  const [first, ...rest] = a;
  const p = typeof first === 'string' ? first : '';
  for (const f of typeof first === 'string' ? rest : a)
    if (typeof f === 'function' && 'stack' in f) rec(this).mounts.push({ child: f, path: p });
  return origUse.apply(this, a);
};

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'z'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};
const METHODS = ['get', 'post', 'put', 'patch', 'delete'] as const;
type M = (typeof METHODS)[number];
const ID = '00000000-0000-4000-8000-000000000001';

/** بلا مصادقة عمداً (تتحقق بنفسها: رمز، سر ويب هوك، أو عامة للتحقق) */
const PUBLIC = [
  /^\/health\//,
  /^\/api\/v1\/auth\/(login|refresh|logout|accept-invite)$/,
  /^\/api\/v1\/public\//,
  /^\/api\/v1\/integrations\/telegram\/webhook\//,
];
/**
 * مسارات تسمح لأي مستخدم موثَّق بلا صلاحية (خدمة ذاتية أو يُقيَّد بحسابه نفسه).
 * أي مسار جديد يظهر هنا يجب أن يُراجَع يدوياً: لماذا لا يحتاج صلاحية؟
 */
const AUTH_ONLY: RegExp[] = [
  // الحساب نفسه والتفضيلات والإشعارات: كلها مقيّدة بالمستخدم الحالي
  /^get \/api\/v1\/auth\/me$/,
  /^get \/api\/v1\/settings\/effective$/,
  /^(get|post) \/api\/v1\/notifications\//,
  /^(get|delete) \/api\/v1\/integrations\/telegram\/me$/,
  // التفويض والموافقات: صندوق المستخدم وطلباته وتفويضاته فقط
  /^get \/api\/v1\/approval-delegations\/(users)?$/,
  /^get \/api\/v1\/approvals\/(inbox|inbox\/count|mine)$/,
  // لوحة المعلومات والتقارير: الأقسام والفهرس تُرشَّح بصلاحيات المستخدم داخلياً
  /^get \/api\/v1\/dashboard\/summary$/,
  /^(get|put|delete) \/api\/v1\/table-prefs\/:tableId$/,
  /^(get|post) \/api\/v1\/me\/admin-actions(\/|\/:id\/acknowledge)?$/,
  // سجلاتي الإدارية: للموظف المرتبط بحسابه فقط (الاستعلام مقيّد بحسابه في الخادم)
  /^(get|post) \/api\/v1\/me\/admin-actions(\/:id\/acknowledge)?$/,
  /^get \/api\/v1\/reports\/(runs)?\/?$/,
  // سياسة تصحيح الحضور: يحتاجها نموذج الطلب لكل موظف
  /^get \/api\/v1\/attendance-corrections\/policy$/,
];

type Route = { method: M; path: string };
const collect = (root: unknown, prefix = ''): Route[] => {
  const out: Route[] = [];
  const r = recs.get(root);
  if (!r) return out;
  for (const x of r.routes)
    for (const m of METHODS) if (x.route.methods[m]) out.push({ method: m, path: prefix + x.path });
  for (const mnt of r.mounts) out.push(...collect(mnt.child, prefix + mnt.path));
  return out;
};

describe('المرحلة 9: المراجعة الأمنية الآلية للمسارات', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let a: string;
  let b: string;
  let api: ReturnType<typeof import('./app.js').createApp>;
  let routes: Route[] = [];
  const tokens: Record<string, string> = {};
  const fill = (p: string) => p.replace(/:[A-Za-z]+(\([^)]*\))?\??/g, ID);
  const send = (m: M, p: string, token?: string) => {
    const req = request(api)[m](fill(p));
    if (token) req.set('Authorization', `Bearer ${token}`);
    return m === 'get' || m === 'delete' ? req : req.send({});
  };

  const mkUser = (company: string, email: string, role: string | null) =>
    withTenant(admin, { companyId: company }, async (ctx) => {
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId: company,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      if (!role) return;
      const r = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', company)
        .where('code', '=', role)
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId: company,
          userId: user.id,
          roleId: r.id,
          scopeType: 'company',
          scopeId: null,
        })
        .execute();
    });
  const login = async (email: string, company: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    const mkCompany = async (slug: string, name: string) =>
      (
        await admin
          .insertInto('companies')
          .values({ slug, nameAr: name })
          .returning('id')
          .executeTakeFirstOrThrow()
      ).id;
    a = await mkCompany('acme', 'شركة أكمي');
    b = await mkCompany('beta', 'شركة بيتا');
    for (const c of [a, b])
      await withTenant(admin, { companyId: c }, (ctx) => seedDefaultRoles(ctx));
    const { createApp } = await import('./app.js');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        publicUrl: 'https://hr.example.com',
        storage: createLocalStorage(mkdtempSync(path.join(tmpdir(), 'hrms-sec-'))),
        render: async () => Buffer.from('%PDF-1.4'),
      },
    });
    // التقاط الراوتر الجذر: التطبيق نفسه يفوّض لـ app.router
    const root = (api as unknown as { router: unknown }).router;
    routes = [
      ...collect(root),
      // المسارات المركّبة على /api/v1 عبر app.use(...)
      ...[...recs.keys()].flatMap((k) => (k === root ? [] : [])),
    ];
    await mkUser(a, 'admin@acme.test', 'admin');
    await mkUser(a, 'nobody@acme.test', null);
    await mkUser(b, 'admin@beta.test', 'admin');
    tokens['admin'] = await login('admin@acme.test', 'acme');
    tokens['nobody'] = await login('nobody@acme.test', 'acme');
    tokens['adminB'] = await login('admin@beta.test', 'beta');
  });
  afterAll(async () => {
    proto.route = origRoute;
    proto.use = origUse;
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  const isPublic = (p: string) => PUBLIC.some((re) => re.test(p));
  const secured = () => routes.filter((r) => !isPublic(r.path));

  it('يجمع المسارات الفعلية من الراوترات (حدّ أدنى معقول)', () => {
    expect(routes.length).toBeGreaterThan(250);
    // eslint-disable-next-line no-console
    console.log(`routes: ${routes.length}, secured: ${secured().length}`);
  });

  it('بلا توكن: 401 لكل مسار غير عام', async () => {
    const bad: string[] = [];
    for (const r of secured()) {
      const res = await send(r.method, r.path);
      if (res.status !== 401) bad.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 120_000);

  it('موثَّق بلا صلاحيات: لا نجاح ولا 5xx إلا لما في القائمة الصريحة', async () => {
    const bad: string[] = [];
    const ok: string[] = [];
    for (const r of secured()) {
      const res = await send(r.method, r.path, tokens['nobody']);
      const label = `${r.method.toUpperCase()} ${r.path} → ${res.status}`;
      if (res.status >= 500 && res.status !== 503) bad.push(label);
      else if (res.status < 300 && !AUTH_ONLY.some((re) => re.test(`${r.method} ${r.path}`)))
        ok.push(label);
    }
    expect({ serverErrors: bad, openToAnyUser: ok }).toEqual({
      serverErrors: [],
      openToAnyUser: [],
    });
  }, 120_000);

  it('المدير بمدخلات فارغة ومعرّفات غير موجودة: لا 5xx', async () => {
    const bad: string[] = [];
    for (const r of secured().filter((x) => !x.path.startsWith('/api/v1/auth/'))) {
      const res = await send(r.method, r.path, tokens['admin']);
      // 503 = ميزة غير مهيّأة في البيئة (طابور/تشفير/تلغرام) وليست عطلاً
      if (res.status >= 500 && res.status !== 503)
        bad.push(`${r.method.toUpperCase()} ${r.path} → ${res.status}`);
    }
    expect(bad).toEqual([]);
  }, 180_000);

  it('عزل الشركات: مدير شركة أخرى لا يرى بيانات شركتنا في أي قائمة', async () => {
    const mk = (p: string, body: object) =>
      request(api).post(`/api/v1${p}`).set('Authorization', `Bearer ${tokens['admin']}`).send(body);
    const emp = await mk('/employees', {
      firstNameAr: 'سرّي',
      familyNameAr: 'تينانت',
      firstHireDate: '2025-01-01',
    });
    expect(emp.status, JSON.stringify(emp.body)).toBe(201);
    await mk('/branches', { code: 'A-SECRET', nameAr: 'فرع-سري-أكمي' });
    const markers = ['تينانت', emp.body.data.id as string, 'فرع-سري-أكمي'];
    const leaks: string[] = [];
    for (const r of secured().filter((x) => x.method === 'get' && !/:[A-Za-z]/.test(x.path))) {
      const res = await request(api).get(r.path).set('Authorization', `Bearer ${tokens['adminB']}`);
      const body = JSON.stringify(res.body) + (res.text ?? '');
      if (markers.some((m) => body.includes(m))) leaks.push(r.path);
    }
    expect(leaks).toEqual([]);
    // ويقرأ مدير شركتنا نفسه البيانات (الفحص ليس فارغاً)
    const own = await request(api)
      .get('/api/v1/employees')
      .set('Authorization', `Bearer ${tokens['admin']}`);
    expect(JSON.stringify(own.body)).toContain('تينانت');
    // ولا يصل لسجل بالمعرّف مباشرة
    const direct = await request(api)
      .get(`/api/v1/employees/${emp.body.data.id}`)
      .set('Authorization', `Bearer ${tokens['adminB']}`);
    expect(direct.status).toBe(404);
  }, 120_000);
});
