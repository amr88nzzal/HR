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

describe('حساب المستخدم من بطاقة الموظف: الدعوة والتفعيل والتعطيل عند إنهاء الخدمة', () => {
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

  const newEmp = async (name: string, extra: object = {}) =>
    (await post('admin', '/employees', { firstNameAr: name, familyNameAr: 'تجربة', ...extra })).body
      .data.id as string;
  const org: Record<string, string> = {};
  const hire = (id: string, effectiveDate = '2024-01-01') =>
    post('admin', `/employees/${id}/changes`, {
      changeType: 'hire',
      effectiveDate,
      employment: {
        employmentType: 'full_time',
        branchId: org['branch'],
        departmentId: org['dept'],
        jobTitleId: org['title'],
      },
    });
  const accept = (token: string, password: string) =>
    request(api).post('/api/v1/auth/accept-invite').send({ token, password });
  const tokenOf = (link: string) => new URL(link, 'http://x').searchParams.get('token')!;
  const NEWPASS = 'Zx9-correct-horse-77';

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
        publicUrl: 'https://hr.example.test',
      },
    });
    await makeUser('admin@acme.test', 'admin');
    await makeUser('hr@acme.test', 'hr_officer');
    for (const who of ['admin', 'hr']) tokens[who] = await login(`${who}@acme.test`);
    const mk = async (path: string, body: object) =>
      (await post('admin', path, body)).body.data.id as string;
    org['branch'] = await mk('/branches', { code: 'RUH', nameAr: 'الرياض' });
    org['dept'] = await mk('/departments', {
      code: 'HR',
      nameAr: 'الموارد',
      branchIds: [org['branch']],
    });
    org['title'] = await mk('/job-titles', { code: 'T1', nameAr: 'أخصائي' });
  });
  afterAll(async () => {
    await app.destroy();
    await admin.destroy();
    await pgx.stop();
  });

  it('الدعوة: رابط لمرة واحدة، الموظف يعيّن كلمته ويدخل ويرى سجله فقط', async () => {
    const e = await newEmp('منى');
    const other = await newEmp('سعد');
    const r = await post('admin', `/employees/${e}/account`, {
      email: 'mona@acme.test',
      delivery: 'invite',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.inviteLink).toContain('https://hr.example.test/accept-invite?token=');
    expect(r.body.data.tempPassword).toBeUndefined();
    const state = await get('admin', `/employees/${e}/account`);
    expect(state.body.data).toMatchObject({ state: 'invited', email: 'mona@acme.test' });
    // قبل التفعيل لا دخول بأي كلمة
    expect(
      (
        await request(api)
          .post('/api/v1/auth/login')
          .send({ identifier: 'mona@acme.test', password: NEWPASS, company: 'acme' })
      ).status,
    ).toBe(401);
    const token = tokenOf(r.body.data.inviteLink);
    expect((await accept(token, 'password123')).status).toBe(400);
    expect((await accept(token, NEWPASS)).status).toBe(204);
    expect((await accept(token, NEWPASS)).status).toBe(400); // مرة واحدة
    const login2 = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: 'mona@acme.test', password: NEWPASS, company: 'acme' });
    expect(login2.status).toBe(200);
    expect(login2.body.data.mustChangePassword).toBe(false);
    tokens['mona'] = login2.body.data.accessToken;
    expect((await get('mona', '/employees')).body.data.map((x: { id: string }) => x.id)).toEqual([
      e,
    ]);
    expect((await get('mona', `/employees/${other}`)).status).toBe(404);
    expect((await get('admin', `/employees/${e}/account`)).body.data.state).toBe('active');
  });

  it('إعادة إرسال الدعوة تُبطل السابقة، ولا تُرسل لحساب مفعّل', async () => {
    const e = await newEmp('هدى');
    const a = await post('admin', `/employees/${e}/account`, { email: 'huda@acme.test' });
    const b = await post('admin', `/employees/${e}/account/resend-invite`, {});
    expect(b.status).toBe(200);
    expect((await accept(tokenOf(a.body.data.inviteLink), NEWPASS)).status).toBe(400);
    expect((await accept(tokenOf(b.body.data.inviteLink), NEWPASS)).status).toBe(204);
    expect((await post('admin', `/employees/${e}/account/resend-invite`, {})).status).toBe(409);
  });

  it('التسليم المؤقت: كلمة تُعرض مرة واحدة ويلزم تغييرها', async () => {
    const e = await newEmp('رامي');
    const r = await post('admin', `/employees/${e}/account`, {
      email: 'rami@acme.test',
      delivery: 'temp',
    });
    expect(r.status).toBe(201);
    expect(r.body.data.tempPassword).toBeTruthy();
    const l = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: 'rami@acme.test', password: r.body.data.tempPassword, company: 'acme' });
    expect(l.status).toBe(200);
    expect(l.body.data.mustChangePassword).toBe(true);
  });

  it('البريد يُؤخذ من جهات الاتصال، وبدونه خطأ، والمكرر مرفوض، وموظف الموارد ممنوع', async () => {
    const e = await newEmp('نور');
    expect((await post('admin', `/employees/${e}/account`, {})).body.error.code).toBe(
      'EMAIL_REQUIRED',
    );
    await post('admin', `/employees/${e}/contacts`, {
      type: 'email',
      value: 'Noor@Acme.test',
      isPrimary: true,
    });
    expect((await post('hr', `/employees/${e}/account`, {})).status).toBe(403);
    const r = await post('admin', `/employees/${e}/account`, {});
    expect(r.status).toBe(201);
    expect(r.body.data.email).toBe('noor@acme.test');
    const dup = await newEmp('نور2');
    expect(
      (await post('admin', `/employees/${dup}/account`, { email: 'noor@acme.test' })).body.error
        .code,
    ).toBe('EMAIL_TAKEN');
  });

  it('الإنشاء مع تعريف الموظف في معاملة واحدة: فشل الحساب يلغي الموظف', async () => {
    const ok = await post('admin', '/employees', {
      firstNameAr: 'جود',
      familyNameAr: 'تجربة',
      account: { email: 'joud@acme.test' },
    });
    expect(ok.status).toBe(201);
    expect(ok.body.meta.account.inviteLink).toBeTruthy();
    const before = (await get('admin', '/employees')).body.meta.total;
    const bad = await post('admin', '/employees', {
      firstNameAr: 'مكرر',
      familyNameAr: 'تجربة',
      account: { email: 'joud@acme.test' },
    });
    expect(bad.status).toBe(409);
    expect((await get('admin', '/employees')).body.meta.total).toBe(before);
    expect(
      (
        await post('hr', '/employees', {
          firstNameAr: 'س',
          familyNameAr: 'ص',
          account: { email: 'z@acme.test' },
        })
      ).status,
    ).toBe(403);
  });

  it('إنهاء الخدمة يعطّل الحساب ويُبطل الجلسة، وإعادة التعيين تفعّله، واليدوي لا يُمَس', async () => {
    const e = await newEmp('كرم');
    expect((await hire(e)).status).toBe(201);
    const r = await post('admin', `/employees/${e}/account`, {
      email: 'karam@acme.test',
      delivery: 'temp',
    });
    const pass = r.body.data.tempPassword as string;
    const l = await request(api)
      .post('/api/v1/auth/login')
      .send({ identifier: 'karam@acme.test', password: pass, company: 'acme' });
    tokens['karam'] = l.body.data.accessToken;
    expect((await get('karam', '/employees')).status).toBe(200);

    const today = new Date().toISOString().slice(0, 10);
    const term = await post('admin', `/employees/${e}/changes`, {
      changeType: 'termination',
      effectiveDate: today,
    });
    expect(term.status).toBe(201);
    const st = (await get('admin', `/employees/${e}/account`)).body.data;
    expect(st).toMatchObject({ state: 'disabled', disabledReason: 'employment_ended' });
    expect((await get('karam', '/employees')).status).toBe(401);
    const list = await get('admin', '/employees?q=كرم');
    expect(list.body.data[0].accountStatus).toBe('disabled');

    const future = new Date(Date.now() + 86_400_000 * 5).toISOString().slice(0, 10);
    expect((await hire(e, future)).status).toBe(201);
    expect((await get('admin', `/employees/${e}/account`)).body.data.state).not.toBe('disabled');

    // تعطيل يدوي ثم إنهاء وإعادة تعيين: يبقى معطلاً
    const user = (await get('admin', `/employees/${e}/account`)).body.data;
    const u = await get('admin', `/users/${user.userId}`);
    await request(api)
      .patch(`/api/v1/users/${user.userId}`)
      .set(as('admin'))
      .send({ status: 'disabled', version: u.body.data.version });
    expect((await get('admin', `/employees/${e}/account`)).body.data).toMatchObject({
      state: 'disabled',
      disabledReason: null,
    });
  });

  it('ربط مستخدم موجود: لا ربط مزدوج', async () => {
    const a = await newEmp('أ');
    const b = await newEmp('ب');
    const u = (await get('admin', '/users?q=hr@acme.test')).body.data[0].id as string;
    const put = (id: string) =>
      request(api).put(`/api/v1/employees/${id}/user`).set(as('admin')).send({ userId: u });
    expect((await put(a)).status).toBe(200);
    expect((await put(b)).status).toBe(409);
  });
  it('إنشاء حسابات بالجملة: معاينة بلا كتابة، ثم تنفيذ يتخطى من بلا بريد أو له حساب أو بريده مكرر', async () => {
    const withMail = async (name: string, mail: string) => {
      const id = await newEmp(name);
      await post('admin', `/employees/${id}/contacts`, {
        type: 'email',
        value: mail,
        isPrimary: true,
      });
      return id;
    };
    const a = await withMail('بسمة', 'basma@acme.test');
    const b = await withMail('جود', 'jood@acme.test');
    const dupA = await withMail('سلمى', 'basma@acme.test'); // نفس بريد بسمة داخل الدفعة
    const noMail = await newEmp('بلا بريد');
    const taken = await withMail('مأخوذ', 'noor@acme.test'); // بريد حساب سابق
    const linked = await newEmp('له حساب');
    await post('admin', `/employees/${linked}/account`, { email: 'linked@acme.test' });
    const ids = [a, b, dupA, noMail, taken, linked];
    // الموارد البشرية بلا صلاحية إنشاء الحسابات
    expect((await post('hr', '/employees/accounts/bulk', { employeeIds: ids })).status).toBe(403);
    // معاينة: لا يُكتب شيء
    const dry = await post('admin', '/employees/accounts/bulk', { employeeIds: ids, dryRun: true });
    expect(dry.status, JSON.stringify(dry.body)).toBe(200);
    const st = (r: typeof dry) =>
      Object.fromEntries(
        r.body.data.map((x: { employeeId: string; status: string }) => [x.employeeId, x.status]),
      );
    expect(st(dry)).toEqual({
      [a]: 'ok',
      [b]: 'ok',
      [dupA]: 'duplicate_email',
      [noMail]: 'no_email',
      [taken]: 'email_taken',
      [linked]: 'has_account',
    });
    expect((await get('admin', `/employees/${a}/account`)).body.data.state).toBe('none');
    // تنفيذ
    const run = await post('admin', '/employees/accounts/bulk', { employeeIds: ids });
    expect(run.status).toBe(200);
    expect(run.body.meta.created).toBe(2);
    expect(st(run)[a]).toBe('created');
    expect((await get('admin', `/employees/${a}/account`)).body.data.state).toBe('invited');
    expect((await get('admin', `/employees/${b}/account`)).body.data.state).toBe('invited');
    expect((await get('admin', `/employees/${dupA}/account`)).body.data.state).toBe('none');
    // إعادة التنفيذ: الجميع تُخطّى
    const again = await post('admin', '/employees/accounts/bulk', { employeeIds: [a, b] });
    expect(again.body.meta.created).toBe(0);
    expect(st(again)[a]).toBe('has_account');
  });
});
