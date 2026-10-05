import { randomBytes } from 'node:crypto';
import { pino } from 'pino';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '../../app.js';
import { createDb, type Db } from '../../db/index.js';
import { withTenant } from '../../db/tenant.js';
import { createFieldCrypto } from '../../shared/crypto.js';
import { startTestPg, type TestPg } from '../../test/pg.js';
import { hashPassword, seedDefaultRoles, syncPermissionCatalog } from '../identity/index.js';

const PASSWORD = 'correct-horse-battery';
const settings = {
  jwtSecret: 'm'.repeat(40),
  accessTtlSeconds: 900,
  refreshTtlDays: 30,
  defaultCompanySlug: 'acme',
};
// الشركة الافتراضية بتوقيت الرياض
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Riyadh' }).format(new Date());

describe('العقود والتعيين الزمني', () => {
  let pgx: TestPg;
  let admin: Db;
  let app: Db;
  let api: ReturnType<typeof createApp>;
  let acme: string;
  const tokens: Record<string, string> = {};
  const ids: Record<string, string> = {};

  const makeUser = (
    companyId: string,
    email: string,
    roleCode: string,
    scope: { type: 'company' | 'branch' | 'team'; id?: string } = { type: 'company' },
  ) =>
    withTenant(admin, { companyId }, async (ctx) => {
      const role = await ctx.trx
        .selectFrom('roles')
        .select('id')
        .where('companyId', '=', companyId)
        .where('code', '=', roleCode)
        .executeTakeFirstOrThrow();
      const user = await ctx.trx
        .insertInto('users')
        .values({
          companyId,
          email,
          displayName: email,
          passwordHash: await hashPassword(PASSWORD),
        })
        .returning('id')
        .executeTakeFirstOrThrow();
      await ctx.trx
        .insertInto('userRoleAssignments')
        .values({
          companyId,
          userId: user.id,
          roleId: role.id,
          scopeType: scope.type,
          scopeId: scope.id ?? null,
        })
        .execute();
      return user.id;
    });
  const login = async (email: string, company?: string) =>
    (
      await request(api)
        .post('/api/v1/auth/login')
        .send({ identifier: email, password: PASSWORD, company })
    ).body.data.accessToken as string;
  const as = (who: string) => ({ Authorization: `Bearer ${tokens[who]}` });
  const post = (who: string, path: string, body: object) =>
    request(api).post(`/api/v1${path}`).set(as(who)).send(body);
  const get = (who: string, path: string) => request(api).get(`/api/v1${path}`).set(as(who));
  const change = (who: string, empId: string, body: object) =>
    post(who, `/employees/${empId}/changes`, body);
  const newEmp = async (name: string) =>
    (await post('admin', '/employees', { firstNameAr: name, familyNameAr: 'تجربة' })).body.data
      .id as string;
  const hire = (empId: string, over: object = {}, effectiveDate = '2024-01-01') =>
    change('admin', empId, {
      changeType: 'hire',
      effectiveDate,
      employment: {
        branchId: ids['ruh'],
        departmentId: ids['hr'],
        employmentType: 'full_time',
        jobTitleId: ids['title'],
        ...over,
      },
    });

  beforeAll(async () => {
    pgx = await startTestPg();
    admin = createDb(pgx.adminUrl);
    app = createDb(pgx.appUrl);
    await admin.transaction().execute((trx) => syncPermissionCatalog(trx));
    const mk = async (slug: string) => {
      const row = await admin
        .insertInto('companies')
        .values({ slug, nameAr: slug })
        .returning('id')
        .executeTakeFirstOrThrow();
      await withTenant(admin, { companyId: row.id }, (ctx) => seedDefaultRoles(ctx));
      return row.id;
    };
    acme = await mk('acme');
    const globex = await mk('globex');
    const k = () => randomBytes(32).toString('base64');
    api = createApp({
      logger: pino({ level: 'silent' }),
      auth: {
        db: app,
        settings,
        cookieSecure: false,
        rateLimit: false,
        crypto: createFieldCrypto({ keysSpec: `k1:${k()}`, currentKeyId: 'k1', digestKey: k() }),
      },
    });
    await makeUser(acme, 'admin@acme.test', 'admin');
    await makeUser(globex, 'admin@globex.test', 'admin');
    tokens['admin'] = await login('admin@acme.test');
    tokens['globex'] = await login('admin@globex.test', 'globex');

    const mkOrg = async (path: string, body: object) =>
      (await post('admin', path, body)).body.data.id as string;
    ids['ruh'] = await mkOrg('/branches', { code: 'RUH', nameAr: 'الرياض' });
    ids['jed'] = await mkOrg('/branches', { code: 'JED', nameAr: 'جدة' });
    ids['hr'] = await mkOrg('/departments', {
      code: 'HR',
      nameAr: 'الموارد',
      branchIds: [ids['ruh'], ids['jed']],
    });
    ids['fin'] = await mkOrg('/departments', {
      code: 'FIN',
      nameAr: 'المالية',
      branchIds: [ids['ruh']],
    });
    ids['title'] = await mkOrg('/job-titles', { code: 'T1', nameAr: 'أخصائي' });
    ids['title2'] = await mkOrg('/job-titles', { code: 'T2', nameAr: 'أخصائي أول' });
    ids['globexBranch'] = (
      await post('globex', '/branches', { code: 'G1', nameAr: 'فرع غلوبكس' })
    ).body.data.id;

    // مدير فريق مرتبط بموظف، ومدير فرع جدة
    ids['mgrEmp'] = await newEmp('المدير');
    await hire(ids['mgrEmp'] as string);
    const mgrUser = await makeUser(acme, 'mgr@acme.test', 'manager', { type: 'team' });
    await admin
      .updateTable('employees')
      .set({ userId: mgrUser })
      .where('id', '=', ids['mgrEmp'] as string)
      .execute();
    await makeUser(acme, 'jed@acme.test', 'hr_manager', { type: 'branch', id: ids['jed'] });
    tokens['mgr'] = await login('mgr@acme.test');
    tokens['jed'] = await login('jed@acme.test');
  });

  afterAll(async () => {
    await admin?.destroy();
    await app?.destroy();
    await pgx?.stop();
  });

  describe('التعيين والتحويل', () => {
    let emp: string;

    it('التعيين الأول ينشئ التعيين ويضبط الحالة وتاريخ أول تعيين', async () => {
      emp = await newEmp('سعد');
      const res = await hire(emp);
      expect(res.status).toBe(201);
      expect(res.body.data.status).toBe('active');
      expect(res.body.data.employment.validFrom).toBe('2024-01-01');
      expect(res.body.data.employment.validTo).toBeNull();
      const e = (await get('admin', `/employees/${emp}`)).body.data;
      expect(e.firstHireDate).toBe('2024-01-01');
    });

    it('تعيين ثانٍ لموظف قائم يُرفض', async () => {
      const res = await hire(emp);
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe('ALREADY_EMPLOYED');
    });

    it('النقل يغلق القديم ويحفظ التاريخ ويفتح الجديد من تاريخ السريان', async () => {
      const res = await change('admin', emp, {
        changeType: 'transfer',
        effectiveDate: '2024-06-01',
        employment: { departmentId: ids['fin'] },
      });
      expect(res.status).toBe(201);
      const history = (await get('admin', `/employees/${emp}/employments`)).body.data;
      expect(history).toHaveLength(2);
      expect(history[0]).toMatchObject({ validFrom: '2024-06-01', validTo: null });
      expect(history[0].departmentNameAr).toBe('المالية');
      expect(history[0].jobTitleId).toBe(ids['title']); // بقية الحقول انتقلت كما هي
      expect(history[1]).toMatchObject({ validFrom: '2024-01-01', validTo: '2024-05-31' });
      const timeline = (await get('admin', `/employees/${emp}/changes`)).body.data;
      expect(timeline.map((c: { changeType: string }) => c.changeType)).toEqual([
        'transfer',
        'hire',
      ]);
    });

    it('الترقية تغيّر المسمى فقط', async () => {
      const res = await change('admin', emp, {
        changeType: 'promotion',
        effectiveDate: '2024-09-01',
        employment: { jobTitleId: ids['title2'] },
      });
      expect(res.status).toBe(201);
      expect(res.body.data.employment).toMatchObject({
        departmentId: ids['fin'],
        jobTitleId: ids['title2'],
      });
    });

    it('رفض: قسم غير متاح في الفرع، حقول لا تناسب النوع، وتاريخ سابق للتعيين الحالي', async () => {
      const wrongDept = await change('admin', emp, {
        changeType: 'transfer',
        effectiveDate: '2025-01-01',
        employment: { branchId: ids['jed'] }, // المالية ليست في جدة
      });
      expect(wrongDept.status).toBe(400);
      expect(wrongDept.body.error.code).toBe('DEPARTMENT_NOT_IN_BRANCH');
      const wrongFields = await change('admin', emp, {
        changeType: 'promotion',
        effectiveDate: '2025-01-01',
        employment: { departmentId: ids['hr'] },
      });
      expect(wrongFields.body.error.code).toBe('MISSING_FIELDS');
      const early = await change('admin', emp, {
        changeType: 'promotion',
        effectiveDate: '2024-09-01',
        employment: { jobTitleId: ids['title'] },
      });
      expect(early.body.error.code).toBe('INVALID_EFFECTIVE_DATE');
    });

    it('الانتقال إلى فرع وقسم معاً ينجح', async () => {
      const res = await change('admin', emp, {
        changeType: 'transfer',
        effectiveDate: '2025-02-01',
        employment: { branchId: ids['jed'], departmentId: ids['hr'] },
      });
      expect(res.status).toBe(201);
    });

    it('مرجع من شركة أخرى يُرفض', async () => {
      const res = await change('admin', emp, {
        changeType: 'transfer',
        effectiveDate: '2025-03-01',
        employment: { branchId: ids['globexBranch'] },
      });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('INVALID_REFERENCE');
    });

    it('قيد القاعدة يمنع تداخل التعيينات حتى لو تخطى الكود', async () => {
      await expect(
        withTenant(admin, { companyId: acme }, (ctx) =>
          ctx.trx
            .insertInto('employments')
            .values({
              companyId: acme,
              employeeId: emp,
              branchId: ids['jed'] as string,
              departmentId: ids['hr'] as string,
              employmentType: 'full_time',
              validFrom: '2025-06-01',
            })
            .execute(),
        ),
      ).rejects.toThrow(/exclusion|overlap|conflicting/i);
    });
  });

  describe('المدير المباشر', () => {
    it('لا يكون الموظف مديراً لنفسه، ويُقبل مدير صالح', async () => {
      const emp = await newEmp('تابع');
      await hire(emp);
      const self = await change('admin', emp, {
        changeType: 'manager_change',
        effectiveDate: '2024-03-01',
        employment: { managerEmployeeId: emp },
      });
      expect(self.body.error.code).toBe('INVALID_MANAGER');
      const ok = await change('admin', emp, {
        changeType: 'manager_change',
        effectiveDate: '2024-03-01',
        employment: { managerEmployeeId: ids['mgrEmp'] },
      });
      expect(ok.status).toBe(201);
      ids['report'] = emp;
    });
  });

  describe('الإيقاف والإنهاء وإعادة التعيين', () => {
    let emp: string;
    it('دورة الحالة: إيقاف ثم إعادة تفعيل ثم إنهاء', async () => {
      emp = await newEmp('حالة');
      await hire(emp);
      const sus = await change('admin', emp, { changeType: 'suspension', effectiveDate: today });
      expect(sus.body.data.status).toBe('suspended');
      const again = await change('admin', emp, { changeType: 'suspension', effectiveDate: today });
      expect(again.status).toBe(409);
      expect(
        (await change('admin', emp, { changeType: 'reinstatement', effectiveDate: today })).body
          .data.status,
      ).toBe('active');
    });

    it('تاريخ مستقبلي لتغيير الحالة مرفوض حالياً', async () => {
      const res = await change('admin', emp, {
        changeType: 'termination',
        effectiveDate: '2999-01-01',
      });
      expect(res.body.error.code).toBe('FUTURE_STATUS_CHANGE');
    });

    it('الإنهاء يغلق التعيين ويُنهي العقد النشط، ولا يقبل نقلاً بعده', async () => {
      const contract = await post('admin', `/employees/${emp}/contracts`, {
        contractType: 'permanent',
        startDate: '2024-01-01',
      });
      expect(contract.status).toBe(201);
      const term = await change('admin', emp, { changeType: 'termination', effectiveDate: today });
      expect(term.body.data.status).toBe('terminated');
      const history = (await get('admin', `/employees/${emp}/employments`)).body.data;
      expect(history[0].validTo).toBe(today);
      const contracts = (await get('admin', `/employees/${emp}/contracts`)).body.data;
      expect(contracts[0]).toMatchObject({ status: 'terminated', endDate: today });
      const after = await change('admin', emp, {
        changeType: 'transfer',
        effectiveDate: today,
        employment: { departmentId: ids['fin'] },
      });
      expect(after.status).toBe(409);
    });

    it('إعادة التعيين بعد الإنهاء تنجح بتاريخ لاحق وتحتفظ بتاريخ أول تعيين', async () => {
      const early = await hire(emp, {}, '2024-02-01');
      expect(early.status).toBe(409);
      const rehire = await hire(emp, {}, '2999-01-01');
      expect(rehire.status).toBe(201);
      expect(rehire.body.data.status).toBe('active');
      const e = (await get('admin', `/employees/${emp}`)).body.data;
      expect(e.firstHireDate).toBe('2024-01-01');
    });
  });

  describe('العقود', () => {
    it('عقدان نشطان متداخلان يُرفضان 409 OVERLAP', async () => {
      const emp = await newEmp('عقد');
      const a = await post('admin', `/employees/${emp}/contracts`, {
        contractType: 'fixed_term',
        startDate: '2024-01-01',
        endDate: '2024-12-31',
      });
      expect(a.status).toBe(201);
      const b = await post('admin', `/employees/${emp}/contracts`, {
        contractType: 'fixed_term',
        startDate: '2024-06-01',
        endDate: '2025-06-01',
      });
      expect(b.status).toBe(409);
      expect(b.body.error.code).toBe('OVERLAP');
      const c = await post('admin', `/employees/${emp}/contracts`, {
        contractType: 'fixed_term',
        startDate: '2025-01-01',
        endDate: '2025-12-31',
      });
      expect(c.status).toBe(201);
    });
  });

  describe('نطاق الرؤية حسب التعيين الحالي', () => {
    it('مدير فرع جدة يرى موظفي جدة فقط، والباقي 404', async () => {
      const inJed = await newEmp('جدّاوي');
      await hire(inJed, { branchId: ids['jed'] });
      const list = (await get('jed', '/employees?pageSize=100')).body.data as {
        id: string;
        currentBranchId: string;
      }[];
      expect(list.map((e) => e.id)).toContain(inJed);
      expect(list.every((e) => e.currentBranchId === ids['jed'])).toBe(true);
      expect((await get('jed', `/employees/${ids['report']}`)).status).toBe(404);
      expect((await get('jed', `/employees/${inJed}/employments`)).status).toBe(200);
      // النقل خارج فرعه يُخفيه عنه، والتاريخ يبقى لمن يملك الصلاحية
      const away = await change('admin', inJed, {
        changeType: 'transfer',
        effectiveDate: '2024-05-01',
        employment: { branchId: ids['ruh'] },
      });
      expect(away.status).toBe(201);
      expect((await get('jed', `/employees/${inJed}`)).status).toBe(404);
    });

    it('مدير الفريق يرى مرؤوسيه المباشرين فقط', async () => {
      const list = (await get('mgr', '/employees?pageSize=100')).body.data as { id: string }[];
      expect(list.map((e) => e.id)).toEqual([ids['report']]);
      expect((await get('mgr', `/employees/${ids['report']}`)).status).toBe(200);
      expect((await get('mgr', `/employees/${ids['mgrEmp']}`)).status).toBe(404);
    });

    it('التصفية بالفرع والقسم', async () => {
      const res = await get('admin', `/employees?branchId=${ids['jed']}&pageSize=100`);
      expect(res.status).toBe(200);
      for (const e of res.body.data) expect(e.currentBranchId).toBe(ids['jed']);
    });

    it('بلا صلاحية إدارة التعيين: 403', async () => {
      const res = await change('mgr', ids['report'] as string, {
        changeType: 'suspension',
        effectiveDate: today,
      });
      expect(res.status).toBe(403);
    });
  });

  describe('أسباب التغيير', () => {
    it('سبب لا يناسب نوع الحدث يُرفض، ويُقبل المناسب', async () => {
      const reason = (
        await post('admin', '/change-reasons', {
          code: 'RESIGN',
          changeType: 'termination',
          nameAr: 'استقالة',
        })
      ).body.data.id;
      const emp = await newEmp('سبب');
      await hire(emp);
      const wrong = await change('admin', emp, {
        changeType: 'suspension',
        effectiveDate: today,
        reasonId: reason,
      });
      expect(wrong.body.error.code).toBe('INVALID_REASON');
      const ok = await change('admin', emp, {
        changeType: 'termination',
        effectiveDate: today,
        reasonId: reason,
      });
      expect(ok.status).toBe(201);
      const timeline = (await get('admin', `/employees/${emp}/changes`)).body.data;
      expect(timeline[0].reasonNameAr).toBe('استقالة');
    });
  });
});
