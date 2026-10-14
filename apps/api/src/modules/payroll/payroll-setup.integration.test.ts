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

describe('الرواتب 7a: المكونات والأسس والجداول والهياكل ورواتب الموظفين', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let acme: string;
  let api: ReturnType<typeof createApp>;
  const tokens: Record<string, string> = {};
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, p: string, body: object = {}) =>
    request(api).post(`/api/v1${p}`).set(as(who)).send(body);
  const patch = (who: string, p: string, body: object) =>
    request(api).patch(`/api/v1${p}`).set(as(who)).send(body);
  const get = (who: string, p: string) => request(api).get(`/api/v1${p}`).set(as(who));
  const del = (who: string, p: string) => request(api).delete(`/api/v1${p}`).set(as(who));

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
  const ids: Record<string, string> = {};

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
      auth: { db: app, settings, cookieSecure: false, rateLimit: false },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    await makeUser('emp@acme.test', 'employee');
    for (const who of ['admin', 'hr', 'emp']) tokens[who] = await login(`${who}@acme.test`);
    await post('admin', '/currencies', {
      code: 'SAR',
      nameAr: 'ريال',
      symbol: 'ر.س',
      isBase: true,
    });
    await post('admin', '/currencies', { code: 'USD', nameAr: 'دولار', symbol: '$' });
    emp = (await post('admin', '/employees', { firstNameAr: 'أحمد', familyNameAr: 'الخطيب' })).body
      .data.id;
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('الصلاحيات: الموظف وموظف الموارد لا يريان الرواتب، والمدير يرى', async () => {
    expect((await get('emp', '/payroll/components')).status).toBe(403);
    expect((await get('hr', '/payroll/components')).status).toBe(403);
    expect((await get('hr', `/employees/${emp}/salaries`)).status).toBe(403);
    expect((await get('admin', '/payroll/components')).status).toBe(200);
    const v = await get('admin', '/payroll/variables');
    expect(v.body.data.map((x: { key: string }) => x.key)).toContain('basic');
  });

  it('جداول النسب: الفحص (فجوة/أول شريحة/آخر شريحة) والإنشاء والتعديل بالإصدار', async () => {
    const t = (brackets: object[]) =>
      post('admin', '/payroll/rate-tables', {
        code: 'TAX',
        nameAr: 'ضريبة',
        mode: 'progressive',
        brackets,
      });
    const gap = await t([
      { from: '0', to: '1000', rate: '0' },
      { from: '1500', to: null, rate: '10' },
    ]);
    expect(gap.status).toBe(400);
    expect((await t([{ from: '100', to: null, rate: '5' }])).status).toBe(400);
    expect((await t([{ from: '0', to: '100', rate: '5' }])).status).toBe(400);
    const ok = await t([
      { from: '0', to: '1000', rate: '0' },
      { from: '1000', to: null, rate: '10' },
    ]);
    expect(ok.status).toBe(201);
    ids['tax'] = ok.body.data.id;
    expect(ok.body.data.brackets).toHaveLength(2);
    expect((await t([{ from: '0', to: null, rate: '1' }])).status).toBe(409);
    const upd = await patch('admin', `/payroll/rate-tables/${ids['tax']}`, {
      version: 1,
      nameAr: 'ضريبة الدخل',
    });
    expect(upd.status).toBe(200);
    expect(upd.body.data.nameAr).toBe('ضريبة الدخل');
    expect(upd.body.data.brackets).toHaveLength(2);
    expect(
      (await patch('admin', `/payroll/rate-tables/${ids['tax']}`, { version: 1, nameAr: 'x' }))
        .status,
    ).toBe(409);
  });

  it('المكونات والأسس: أنواع الاحتساب، الصيغ، والحلقات', async () => {
    const comp = (c: object) => post('admin', '/payroll/components', c);
    const housing = await comp({
      code: 'housing',
      nameAr: 'بدل سكن',
      kind: 'earning',
      calcType: 'fixed',
      fixedAmount: '500',
    });
    expect(housing.status).toBe(201);
    ids['housing'] = housing.body.data.id;
    const transport = await comp({
      code: 'transport',
      nameAr: 'بدل نقل',
      kind: 'earning',
      calcType: 'fixed',
      fixedAmount: '200',
    });
    ids['transport'] = transport.body.data.id;
    // حقول ناقصة لنوع الاحتساب
    expect(
      (
        await comp({
          code: 'bad1',
          nameAr: 'x',
          kind: 'earning',
          calcType: 'percent',
          percent: '5',
        })
      ).status,
    ).toBe(400);
    expect(
      (await comp({ code: 'bad2', nameAr: 'x', kind: 'earning', calcType: 'fixed' })).status,
    ).toBe(400);

    // أساس يشمل الأساسي والسكن
    const insurable = await post('admin', '/payroll/bases', {
      code: 'insurable',
      nameAr: 'أساس التأمينات',
      includesBasic: true,
      componentIds: [ids['housing']],
    });
    expect(insurable.status).toBe(201);
    ids['insurable'] = insurable.body.data.id;
    expect(insurable.body.data.componentIds).toEqual([ids['housing']]);
    const gross = await post('admin', '/payroll/bases', {
      code: 'gross',
      nameAr: 'الإجمالي',
      includesBasic: true,
      componentIds: [ids['housing'], ids['transport']],
    });
    ids['gross'] = gross.body.data.id;

    const social = await comp({
      code: 'social',
      nameAr: 'تأمينات',
      kind: 'deduction',
      calcType: 'percent',
      percent: '9.75',
      baseId: ids['insurable'],
    });
    expect(social.status).toBe(201);
    ids['social'] = social.body.data.id;
    const tax = await comp({
      code: 'tax',
      nameAr: 'ضريبة',
      kind: 'deduction',
      calcType: 'rate_table',
      rateTableId: ids['tax'],
      baseId: ids['gross'],
    });
    expect(tax.status).toBe(201);
    const late = await comp({
      code: 'late_ded',
      nameAr: 'خصم تأخير',
      kind: 'deduction',
      calcType: 'formula',
      formula: "round(basic / days_in_period * absent_days + base('insurable') * 0, 2)",
    });
    expect(late.status).toBe(201);
    ids['late'] = late.body.data.id;

    // صيغ مرفوضة
    const bad = await comp({
      code: 'bad3',
      nameAr: 'x',
      kind: 'earning',
      calcType: 'formula',
      formula: 'basic * nope + table("zzz", 1)',
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details.problems.join()).toContain('nope');
    expect(bad.body.error.details.problems.join()).toContain('zzz');
    expect(
      (
        await comp({
          code: 'bad4',
          nameAr: 'x',
          kind: 'earning',
          calcType: 'formula',
          formula: 'process.exit()',
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await comp({
          code: 'bad5',
          nameAr: 'x',
          kind: 'earning',
          calcType: 'formula',
          formula: 'bad5 + 1',
        })
      ).status,
    ).toBe(400);

    // مكوّن يعتمد على آخر بالرمز
    const bonus = await comp({
      code: 'bonus',
      nameAr: 'مكافأة',
      kind: 'earning',
      calcType: 'formula',
      formula: 'housing * 0.1',
    });
    expect(bonus.status).toBe(201);
    ids['bonus'] = bonus.body.data.id;
    // حلقة: السكن يعتمد على المكافأة
    const loop = await patch('admin', `/payroll/components/${ids['housing']}`, {
      version: 1,
      calcType: 'formula',
      formula: 'bonus + 1',
    });
    expect(loop.status).toBe(400);
    expect(loop.body.error.code).toBe('CIRCULAR_DEPENDENCY');
    // حلقة عبر الأساس: التأمينات نسبة من أساس يضم التأمينات
    const loop2 = await patch('admin', `/payroll/bases/${ids['insurable']}`, {
      version: 1,
      componentIds: [ids['housing'], ids['social']],
    });
    expect(loop2.status).toBe(400);
    expect(loop2.body.error.code).toBe('CIRCULAR_DEPENDENCY');
    // الإلغاء رجع كل شيء كما كان
    const bases = await get('admin', '/payroll/bases');
    const ins = bases.body.data.find((b: { code: string }) => b.code === 'insurable');
    expect(ins.componentIds).toEqual([ids['housing']]);
    expect(ins.version).toBe(1);

    // PATCH جزئي لا يمسح الأعضاء ولا العلم
    const p = await patch('admin', `/payroll/bases/${ids['insurable']}`, {
      version: 1,
      nameAr: 'أساس التأمين',
    });
    expect(p.status).toBe(200);
    expect(p.body.data.includesBasic).toBe(true);
    expect(p.body.data.componentIds).toEqual([ids['housing']]);

    // حذف مكوّن مذكور في صيغة، ومكوّن عضو في أساس
    expect((await del('admin', `/payroll/components/${ids['housing']}`)).status).toBe(409);
    expect((await del('admin', `/payroll/bases/${ids['insurable']}`)).status).toBe(409);
    // تعديل نوع الاحتساب مع تنظيف حقول النوع القديم
    const toFixed = await patch('admin', `/payroll/components/${ids['social']}`, {
      version: 1,
      calcType: 'fixed',
      fixedAmount: '120',
    });
    expect(toFixed.status).toBe(200);
    expect(toFixed.body.data).toMatchObject({
      calcType: 'fixed',
      fixedAmount: '120.0000',
      percent: null,
      baseId: null,
    });
    expect((await del('admin', `/payroll/components/${ids['bonus']}`)).status).toBe(204);
  });

  it('الهياكل: إنشاء بمكونات وتعديل واستبدال وتعارض إصدار', async () => {
    const s = await post('admin', '/payroll/structures', {
      code: 'STD',
      nameAr: 'الهيكل العام',
      currency: 'SAR',
      items: [{ componentId: ids['housing'], amount: '600' }, { componentId: ids['transport'] }],
    });
    expect(s.status).toBe(201);
    ids['std'] = s.body.data.id;
    expect(s.body.data.items).toHaveLength(2);
    expect(
      (
        await post('admin', '/payroll/structures', {
          code: 'DUP',
          nameAr: 'x',
          items: [{ componentId: ids['housing'] }, { componentId: ids['housing'] }],
        })
      ).status,
    ).toBe(400);
    const u = await patch('admin', `/payroll/structures/${ids['std']}`, {
      version: 1,
      items: [{ componentId: ids['transport'], amount: '250' }],
    });
    expect(u.status).toBe(200);
    expect(u.body.data.items).toHaveLength(1);
    expect(u.body.data.items[0].amount).toBe('250.0000');
    expect(
      (await patch('admin', `/payroll/structures/${ids['std']}`, { version: 1, nameAr: 'z' }))
        .status,
    ).toBe(409);
    // نفس الاسم بلا items لا يمسحها
    const n = await patch('admin', `/payroll/structures/${ids['std']}`, {
      version: 2,
      nameAr: 'هيكل',
    });
    expect(n.body.data.items).toHaveLength(1);
  });

  it('رواتب الموظف: خط زمني بلا تداخل، تصحيح، حذف الأحدث', async () => {
    const sal = (b: object) => post('admin', `/employees/${emp}/salaries`, b);
    const a = await sal({
      structureId: ids['std'],
      currency: 'SAR',
      basicAmount: '5000',
      validFrom: '2025-01-01',
      components: [{ componentId: ids['housing'], amount: '700' }],
    });
    expect(a.status).toBe(201);
    expect(a.body.data).toMatchObject({
      basicAmount: '5000.0000',
      validFrom: '2025-01-01',
      validTo: null,
    });
    expect(a.body.data.components).toHaveLength(1);

    expect((await sal({ currency: 'USD', basicAmount: '1', validFrom: '2025-01-01' })).status).toBe(
      409,
    );
    expect(
      (await sal({ currency: 'SAR', basicAmount: '5500', validFrom: '2024-06-01' })).status,
    ).toBe(409);
    expect(
      (
        await sal({
          structureId: ids['std'],
          currency: 'USD',
          basicAmount: '1',
          validFrom: '2025-03-01',
        })
      ).status,
    ).toBe(400);
    expect((await sal({ currency: 'EUR', basicAmount: '1', validFrom: '2025-03-01' })).status).toBe(
      400,
    );
    expect(
      (await sal({ currency: 'SAR', basicAmount: '-5', validFrom: '2025-03-01' })).status,
    ).toBe(400);

    const b = await sal({ currency: 'SAR', basicAmount: '5500.5', validFrom: '2025-07-01' });
    expect(b.status).toBe(201);
    const list = await get('admin', `/employees/${emp}/salaries`);
    expect(
      list.body.data.map((r: { validFrom: string; validTo: string | null }) => [
        r.validFrom,
        r.validTo,
      ]),
    ).toEqual([
      ['2025-07-01', null],
      ['2025-01-01', '2025-06-30'],
    ]);

    const fix = await patch('admin', `/employees/${emp}/salaries/${b.body.data.id}`, {
      version: b.body.data.version,
      basicAmount: '5600',
      note: 'تصحيح',
    });
    expect(fix.status).toBe(200);
    expect(fix.body.data).toMatchObject({ basicAmount: '5600.0000', note: 'تصحيح' });
    expect(
      (
        await patch('admin', `/employees/${emp}/salaries/${b.body.data.id}`, {
          version: 1,
          note: 'x',
        })
      ).status,
    ).toBe(409);

    // حذف غير الأحدث مرفوض، وحذف الأحدث يعيد فتح السابق
    expect((await del('admin', `/employees/${emp}/salaries/${a.body.data.id}`)).status).toBe(409);
    expect((await del('admin', `/employees/${emp}/salaries/${b.body.data.id}`)).status).toBe(204);
    const after = await get('admin', `/employees/${emp}/salaries`);
    expect(after.body.data).toHaveLength(1);
    expect(after.body.data[0].validTo).toBeNull();
  });
});
